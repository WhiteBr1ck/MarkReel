import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { Transform, pipeline } from "node:stream";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { getMediaAccess, hasMediaCapability } from "../access";
import { getUserId, requireUser } from "../auth/requireUser";
import { verifyPassword } from "../auth/password";
import { sha256Hex } from "../share";
import { getObjectStream, presignInternalGetObject } from "../s3";
import { ANNOTATION_FRAME_HEIGHT, ANNOTATION_FRAME_WIDTH, annotationMediaFrameKey, cachedExportFrame, extractExportFrame } from "../annotationExportFiles";
import {
  ANNOTATION_EXPORT_LIMITS as limits, AnnotationExportError, AnnotationExportInput,
  attachmentExportName, exportDisposition, threadAnnotations, type ExportAttachment, type ExportInput, type ExportSnapshot
} from "../annotationExport";
import { AnnotationExportJobs, serializeAnnotationExport } from "../annotationExportJobs";
import { registerAnnotationExportShareVisits, requireAnnotationExportShareVisit } from "../annotationExportShareAccess";

const Params = z.object({
  mediaId: z.string().min(1).max(128), token: z.string().min(1).max(256).optional(),
  exportId: z.string().uuid().optional(), annotationId: z.string().min(1).max(128).optional(),
  attachmentId: z.string().min(1).max(128).optional()
});
const FrameQuery = z.object({ timestampMs: z.string().regex(/^\d{1,10}$/).transform(Number).pipe(z.number().int().min(0).max(2147483647)) }).strict();

function passwordCookie(link: { id: string; passwordHash: string | null }, timestamp: string) {
  return createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(`annotation-export:${link.id}:${link.passwordHash}:${timestamp}`).digest("hex");
}

function hasPasswordCookie(req: FastifyRequest, link: { id: string; passwordHash: string | null }) {
  const cookie = req.cookies?.[`mr_export_${sha256Hex(link.id).slice(0, 16)}`];
  if (!cookie) return false;
  const [timestamp, signature] = cookie.split(".");
  if (!timestamp || !signature || !/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const age = Date.now() - Number(timestamp);
  if (age < 0 || age > 5 * 60 * 1000) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(passwordCookie(link, timestamp), "hex"));
}

async function authorize(req: FastifyRequest, reply: FastifyReply, params: z.infer<typeof Params>) {
  if (env.MARKREEL_STORE === "inmemory") throw new AnnotationExportError("exports_require_persistent_store", 503);
  if (!params.token) {
    await requireUser(req, reply);
    if (reply.sent) return null;
    const userId = getUserId(req);
    const access = await getMediaAccess({ userId, mediaId: params.mediaId });
    if (!access || !hasMediaCapability(access.access, "media:view")) throw new AnnotationExportError("not_found", 404);
    return `user:${userId}`;
  }
  // A link's database ID is not a credential. Only the original opaque token is accepted.
  const link = await prisma.shareLink.findUnique({ where: { tokenHash: sha256Hex(params.token) },
    select: { id: true, tokenHash: true, projectId: true, mediaId: true, audience: true, passwordHash: true, revokedAt: true,
      expiresAt: true, maxUses: true, useCount: true, permissions: { select: { permission: true } } } });
  if (!link) throw new AnnotationExportError("not_found", 404);
  if (link.revokedAt) throw new AnnotationExportError("revoked", 410);
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) throw new AnnotationExportError("expired", 410);
  if (!link.permissions.some(({ permission }) => ["view", "comment", "annotate"].includes(permission))) throw new AnnotationExportError("forbidden", 403);
  const media = await prisma.media.findFirst({ where: { id: params.mediaId, deletedAt: null, project: { deletedAt: null } }, select: { projectId: true } });
  if (!media || (link.mediaId ? link.mediaId !== params.mediaId : !link.projectId || link.projectId !== media.projectId)) throw new AnnotationExportError("not_found", 404);
  let principal = `share:${link.id}`;
  if (link.audience === "authenticated") {
    await requireUser(req, reply);
    if (reply.sent) return null;
    principal += `:user:${getUserId(req)}`;
  }
  if (link.passwordHash && !hasPasswordCookie(req, link)) {
    const password = z.string().max(200).safeParse(req.headers["x-markreel-share-password"]);
    if (!password.success || !await verifyPassword(password.data, link.passwordHash)) throw new AnnotationExportError("invalid_share_password", 401);
    const timestamp = String(Date.now());
    reply.setCookie(`mr_export_${sha256Hex(link.id).slice(0, 16)}`, `${timestamp}.${passwordCookie(link, timestamp)}`, {
      path: "/", httpOnly: true, sameSite: "lax", secure: req.protocol === "https", maxAge: 300
    });
  }
  await requireAnnotationExportShareVisit(req, reply, link);
  return principal;
}

async function exportSnapshot(mediaId: string, input: ExportInput): Promise<ExportSnapshot> {
  const media = await prisma.media.findFirst({
    where: { id: mediaId, deletedAt: null, project: { deletedAt: null } },
    select: { id: true, projectId: true, title: true, versionIndex: true, files: {
      orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 1,
      select: { id: true, originalObjectKey: true, sizeBytes: true, durationMs: true, createdAt: true }
    } }
  });
  if (!media) throw new AnnotationExportError("not_found", 404);
  const rows = await prisma.annotation.findMany({
    where: { mediaId, projectId: media.projectId, deletedAt: null },
    orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: limits.annotations + 1,
    select: {
      id: true, parentId: true, timestampMs: true, body: true, completedAt: true, createdAt: true,
      author: { select: { username: true, displayName: true } }
    }
  });
  if (rows.length > limits.annotations) throw new AnnotationExportError("annotation_resource_limit", 413);
  const all = rows.map((row) => ({ ...row, attachments: [] as ExportAttachment[] }));
  let selected = all;
  if (input.annotationId) {
    const root = all.find((annotation) => annotation.id === input.annotationId);
    if (!root) throw new AnnotationExportError("not_found", 404);
    const ids = new Set([root.id]);
    for (let previous = 0; previous !== ids.size;) {
      previous = ids.size;
      for (const annotation of all) if (annotation.parentId && ids.has(annotation.parentId)) ids.add(annotation.id);
    }
    selected = all.filter((annotation) => ids.has(annotation.id)).map((annotation) => annotation.id === root.id ? { ...annotation, parentId: null } : annotation);
  }
  const threads = threadAnnotations(selected).filter(({ root }) => input.status === "all" || (input.status === "completed" ? !!root.completedAt : !root.completedAt));
  if (threads.length > limits.rows) throw new AnnotationExportError("row_resource_limit", 413);
  const annotations = threads.flatMap(({ root, replies }) => [root, ...replies]);
  const attachments = annotations.length ? await prisma.attachment.findMany({
    where: { annotationId: { in: annotations.map((annotation) => annotation.id) } },
    orderBy: [{ annotationId: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: limits.attachments + 1,
    select: { id: true, annotationId: true, objectKey: true, mimeType: true, width: true, height: true }
  }) : [];
  if (attachments.length > limits.attachments) throw new AnnotationExportError("attachment_resource_limit", 413);
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  for (const attachment of attachments) byId.get(attachment.annotationId)!.attachments.push(attachment);
  return { media: { id: media.id, title: media.title, versionIndex: media.versionIndex, file: media.files[0] ?? null }, annotations };
}

export async function annotationExportRoutes(app: FastifyInstance) {
  registerAnnotationExportShareVisits(app);
  const jobs = new AnnotationExportJobs();
  let directDownloads = 0;
  let resultDownloads = 0;
  let directFrames = 0;
  app.addHook("onClose", async () => { await jobs.close(); });
  const guarded = (handler: (req: FastifyRequest, reply: FastifyReply, params: z.infer<typeof Params>, principal: string) => Promise<unknown>) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        const params = Params.safeParse(req.params);
        if (!params.success) return reply.code(400).send({ error: "validation_error" });
        const principal = await authorize(req, reply, params.data);
        if (!principal) return;
        reply.header("cache-control", "private, no-store");
        reply.header("x-content-type-options", "nosniff");
        reply.header("referrer-policy", "no-referrer");
        return await handler(req, reply, params.data, principal);
      } catch (error) {
        if (error instanceof AnnotationExportError) return reply.code(error.statusCode).send({ error: error.code });
        throw error;
      }
    };
  for (const prefix of ["/media/:mediaId", "/share/:token/media/:mediaId"]) {
    const base = `${prefix}/annotation-exports`;
    app.get(`${prefix}/frame`, guarded(async (req, reply, params) => {
      const query = FrameQuery.safeParse(req.query);
      if (!query.success) return reply.code(400).send({ error: "validation_error" });
      const file = await prisma.mediaFile.findFirst({ where: { mediaId: params.mediaId },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        select: { id: true, originalObjectKey: true, durationMs: true, createdAt: true }
      });
      if (!file) throw new AnnotationExportError("source_unavailable", 404);
      if (file.durationMs === null || file.durationMs <= 0) throw new AnnotationExportError("duration_unavailable", 409);
      if (query.data.timestampMs >= file.durationMs) throw new AnnotationExportError("timestamp_out_of_range", 422);
      // Even a cached JPEG is private media. Authorization and bounds checks always precede it.
      const key = annotationMediaFrameKey(params.mediaId, file, query.data.timestampMs);
      let frame = cachedExportFrame(key);
      if (!frame) {
        if (directFrames >= 8) throw new AnnotationExportError("export_limit_reached", 429);
        directFrames += 1;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        const abort = () => { if (!reply.raw.writableEnded) controller.abort(); };
        reply.raw.once("close", abort);
        try {
          const source = await presignInternalGetObject({ bucket: env.S3_BUCKET_ORIGINAL, objectKey: file.originalObjectKey, expiresInSeconds: 300 });
          frame = await extractExportFrame(source, query.data.timestampMs, key, controller.signal, true);
        } catch (error) {
          if (controller.signal.aborted && !reply.raw.destroyed) throw new AnnotationExportError("frame_timeout", 503);
          throw error;
        } finally { clearTimeout(timeout); reply.raw.off("close", abort); directFrames -= 1; }
      }
      reply.header("x-frame-width", String(ANNOTATION_FRAME_WIDTH));
      reply.header("x-frame-height", String(ANNOTATION_FRAME_HEIGHT));
      reply.header("x-frame-timestamp-ms", String(query.data.timestampMs));
      reply.type("image/jpeg");
      return reply.send(frame);
    }));
    app.post(base, guarded(async (req, reply, params, principal) => {
      const input = AnnotationExportInput.safeParse(req.body);
      if (!input.success) return reply.code(400).send({ error: "validation_error", issues: input.error.issues });
      const snapshot = await exportSnapshot(params.mediaId, input.data);
      const job = await jobs.create(principal, snapshot, input.data);
      return reply.code(202).send({ export: serializeAnnotationExport(job) });
    }));
    app.get(`${base}/:exportId`, guarded(async (_req, reply, params, principal) => {
      const job = await jobs.find(params.exportId!, principal, params.mediaId);
      if (!job) return reply.code(404).send({ error: "not_found" });
      return { export: serializeAnnotationExport(job) };
    }));
    app.delete(`${base}/:exportId`, guarded(async (_req, reply, params, principal) => {
      const job = await jobs.find(params.exportId!, principal, params.mediaId);
      if (!job) return reply.code(404).send({ error: "not_found" });
      await jobs.cancel(job);
      return { export: serializeAnnotationExport(job) };
    }));
    app.get(`${base}/:exportId/file`, guarded(async (_req, reply, params, principal) => {
      const job = await jobs.find(params.exportId!, principal, params.mediaId);
      if (!job) return reply.code(404).send({ error: "not_found" });
      if (job.state !== "completed" || !job.output) return reply.code(409).send({ error: "export_not_ready" });
      if (resultDownloads >= 8) throw new AnnotationExportError("export_limit_reached", 429);
      resultDownloads += 1;
      reply.header("content-disposition", exportDisposition(job.filename));
      reply.header("content-length", String(job.bytes));
      reply.type(job.format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/zip");
      const stream = createReadStream(job.output);
      const abort = () => stream.destroy();
      const timeout = setTimeout(abort, limits.jobTimeoutMs);
      reply.raw.once("close", abort);
      stream.once("close", () => { clearTimeout(timeout); reply.raw.off("close", abort); resultDownloads -= 1; });
      return reply.send(stream);
    }));
    app.get(`${prefix}/annotations/:annotationId/attachments/:attachmentId/download`, guarded(async (_req, reply, params) => {
      const attachment = await prisma.attachment.findFirst({
        where: { id: params.attachmentId!, annotationId: params.annotationId!,
          annotation: { mediaId: params.mediaId, deletedAt: null } },
        select: { id: true, annotationId: true, objectKey: true, mimeType: true, width: true, height: true }
      });
      if (!attachment || !attachment.objectKey.startsWith("attachments/")) return reply.code(404).send({ error: "not_found" });
      if (directDownloads >= 8) throw new AnnotationExportError("export_limit_reached", 429);
      directDownloads += 1;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      const abort = () => controller.abort();
      reply.raw.once("close", abort);
      let streaming = false;
      try {
        const object = await getObjectStream({ bucket: env.S3_BUCKET_ATTACHMENTS, objectKey: attachment.objectKey, abortSignal: controller.signal });
        if (!object.body) throw new AnnotationExportError("attachment_unavailable", 404);
        if (object.contentLength !== undefined && object.contentLength > limits.attachmentBytes) {
          object.body.destroy();
          throw new AnnotationExportError("resource_limit", 413);
        }
        let bytes = 0;
        const cap = new Transform({ transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > limits.attachmentBytes ? new AnnotationExportError("resource_limit", 413) : null, chunk);
        } });
        reply.header("content-disposition", exportDisposition(attachmentExportName(attachment, 0)));
        reply.type("application/octet-stream");
        const onAbort = () => object.body!.destroy(new Error("download_cancelled"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        streaming = true;
        pipeline(object.body, cap, () => {
          controller.signal.removeEventListener("abort", onAbort);
          reply.raw.off("close", abort);
          clearTimeout(timeout);
          directDownloads -= 1;
        });
        return reply.send(cap);
      } catch (error) {
        if (error instanceof AnnotationExportError) throw error;
        throw new AnnotationExportError("attachment_unavailable", 503);
      } finally {
        if (!streaming) { directDownloads -= 1; clearTimeout(timeout); reply.raw.off("close", abort); }
      }
    }));
  }
}
