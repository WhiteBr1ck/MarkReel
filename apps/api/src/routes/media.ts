import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../db";
import { getUserId, requireUser } from "../auth/requireUser";
import { presignGetObject, presignPutObject, statObject } from "../s3";
import { env } from "../env";
import { auditLog } from "../audit";
import { mediaQueue } from "../queue";

const CreateMediaSchema = z.object({
  title: z.string().min(1).max(200),
  folderId: z.string().optional().nullable(),
  seriesId: z.string().optional()
});

const UpdateMediaSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().trim().min(1).nullable().optional()
});

const PresignVideoSchema = z.object({
  filename: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120),
  mode: z.enum(["original", "compress"]).default("compress")
});

const EnqueueSchema = z.object({
  mode: z.enum(["original", "compress"]),
  originalObjectKey: z.string().min(1)
});

const PreviewQuerySchema = z.object({
  inline: z.coerce.boolean().optional().default(true)
});

const DownloadQuerySchema = z.object({
  inline: z.coerce.boolean().optional().default(false)
});

const execFileAsync = promisify(execFile);

const FfprobeFormatSchema = z.object({
  duration: z.string().optional(),
  bit_rate: z.string().optional()
});

const FfprobeStreamSchema = z.object({
  codec_type: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.string().optional(),
  bit_rate: z.string().optional(),
  nb_frames: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional()
});

const FfprobeResultSchema = z.object({
  format: FfprobeFormatSchema.optional(),
  streams: z.array(FfprobeStreamSchema).optional()
});

function parseNumericString(value?: string | null) {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function parseFrameRate(value?: string | null) {
  if (!value) return undefined;
  if (value === "0/0") return undefined;
  const [numRaw, denRaw] = value.split("/");
  const num = Number(numRaw);
  const den = Number(denRaw ?? "1");
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}

async function readMediaMetadata(objectKey: string) {
  const stat = await statObject({
    bucket: env.S3_BUCKET_ORIGINAL,
    objectKey
  });

  const mediaUrl = await presignGetObject({
    bucket: env.S3_BUCKET_ORIGINAL,
    objectKey,
    expiresInSeconds: 900
  });
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    mediaUrl
  ]);

  const parsed = FfprobeResultSchema.parse(JSON.parse(stdout));
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");

  const durationSeconds =
    parseNumericString(videoStream?.duration) ??
    parseNumericString(parsed.format?.duration);
  const bitrate =
    parseNumericString(videoStream?.bit_rate) ??
    parseNumericString(parsed.format?.bit_rate);
  const explicitFrames = parseNumericString(videoStream?.nb_frames);
  const fps = parseFrameRate(videoStream?.avg_frame_rate) ?? parseFrameRate(videoStream?.r_frame_rate);
  const derivedFrameCount = !explicitFrames && durationSeconds && fps ? Math.round(durationSeconds * fps) : undefined;

  return {
    sizeBytes: stat.sizeBytes,
    durationMs: durationSeconds ? Math.max(1, Math.round(durationSeconds * 1000)) : undefined,
    width: videoStream?.width,
    height: videoStream?.height,
    bitrateKbps: bitrate ? Math.max(1, Math.round(bitrate / 1000)) : undefined,
    frameCount: explicitFrames ? Math.max(1, Math.round(explicitFrames)) : derivedFrameCount ? Math.max(1, derivedFrameCount) : undefined
  };
}

async function assertProjectAccess(userId: string, projectId: string) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      deletedAt: null,
      OR: [{ ownerId: userId }, { members: { some: { userId } } }]
    },
    select: { id: true }
  });
  return !!project;
}

async function assertMediaAccess(userId: string, mediaId: string) {
  const media = await prisma.media.findFirst({
    where: {
      id: mediaId,
      deletedAt: null,
      project: {
        deletedAt: null,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }]
      }
    },
    select: { id: true, projectId: true }
  });
  return media;
}

async function assertMediaAccessIncludingDeleted(userId: string, mediaId: string) {
  const media = await prisma.media.findFirst({
    where: {
      id: mediaId,
      project: {
        deletedAt: null,
        OR: [{ ownerId: userId }, { members: { some: { userId } } }]
      }
    },
    select: { id: true, projectId: true, deletedAt: true }
  });
  return media;
}

async function assertFolderAccess(projectId: string, folderId: string | null | undefined) {
  if (!folderId) return true;
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, projectId, deletedAt: null },
    select: { id: true }
  });
  return !!folder;
}

export async function mediaRoutes(app: FastifyInstance) {
  app.post(
    "/projects/:projectId/media",
    { preHandler: requireUser },
    async (req, reply) => {
      const userId = getUserId(req);
      const projectId = (req.params as any).projectId as string;
      const input = CreateMediaSchema.parse(req.body);

      const ok = await assertProjectAccess(userId, projectId);
      if (!ok) return reply.code(404).send({ error: "not_found" });

      const folderOk = await assertFolderAccess(projectId, input.folderId ?? null);
      if (!folderOk) return reply.code(404).send({ error: "folder_not_found" });

      const media = await prisma.media.create({
        data: {
          projectId,
          folderId: input.folderId ?? null,
          title: input.title,
          seriesId: input.seriesId ?? null
        },
        select: {
          id: true,
          projectId: true,
          folderId: true,
          title: true,
          status: true,
          reviewStatus: true,
          createdAt: true,
          updatedAt: true
        }
      });

      await auditLog({
        req,
        actorUserId: userId,
        action: "media.create",
        entityType: "Media",
        entityId: media.id,
        meta: { projectId, folderId: media.folderId }
      });

      return reply.code(201).send({ media });
    }
  );

  app.patch("/media/:mediaId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const input = UpdateMediaSchema.parse(req.body);
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    if (input.folderId !== undefined) {
      const folderOk = await assertFolderAccess(access.projectId, input.folderId);
      if (!folderOk) return reply.code(404).send({ error: "folder_not_found" });
    }

    const media = await prisma.media.update({
      where: { id: mediaId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.folderId !== undefined ? { folderId: input.folderId } : {})
      },
      select: {
        id: true,
        projectId: true,
        folderId: true,
        title: true,
        status: true,
        reviewStatus: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.update",
      entityType: "Media",
      entityId: media.id,
      meta: { title: media.title, folderId: media.folderId }
    });

    return reply.send({ media });
  });

  app.delete("/media/:mediaId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const media = await prisma.media.update({
      where: { id: mediaId },
      data: { deletedAt: new Date() },
      select: { id: true, title: true }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.delete",
      entityType: "Media",
      entityId: media.id,
      meta: { title: media.title }
    });

    return reply.send({ ok: true });
  });

  app.get("/projects/:projectId/trash", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const ok = await assertProjectAccess(userId, projectId);
    if (!ok) return reply.code(404).send({ error: "not_found" });

    const items = await prisma.media.findMany({
      where: { projectId, deletedAt: { not: null } },
      select: {
        id: true,
        folderId: true,
        title: true,
        updatedAt: true,
        deletedAt: true,
        files: {
          select: {
            durationMs: true,
            width: true,
            height: true,
            sizeBytes: true,
            bitrateKbps: true,
            frameCount: true
          },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      },
      orderBy: [{ deletedAt: "desc" }]
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        kind: "video" as const,
        name: item.title,
        updatedAt: item.updatedAt.getTime(),
        deletedAt: item.deletedAt?.getTime() ?? null,
        durationSeconds: item.files[0]?.durationMs ? Math.round(item.files[0].durationMs / 1000) : undefined,
        sizeBytes: item.files[0]?.sizeBytes ?? undefined,
        width: item.files[0]?.width ?? undefined,
        height: item.files[0]?.height ?? undefined,
        frameCount: item.files[0]?.frameCount ?? undefined,
        bitrateKbps: item.files[0]?.bitrateKbps ?? undefined
      }))
    };
  });

  app.post("/media/:mediaId/restore", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccessIncludingDeleted(userId, mediaId);
    if (!access || !access.deletedAt) return reply.code(404).send({ error: "not_found" });

    const media = await prisma.media.update({
      where: { id: mediaId },
      data: { deletedAt: null },
      select: { id: true, title: true }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.restore",
      entityType: "Media",
      entityId: media.id,
      meta: { title: media.title }
    });

    return reply.send({ ok: true });
  });

  app.delete("/projects/:projectId/trash", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const ok = await assertProjectAccess(userId, projectId);
    if (!ok) return reply.code(404).send({ error: "not_found" });

    const trashed = await prisma.media.findMany({
      where: { projectId, deletedAt: { not: null } },
      select: { id: true, title: true }
    });

    const mediaIds = trashed.map((item) => item.id);
    if (mediaIds.length === 0) return reply.send({ ok: true, deleted: 0 });

    await prisma.$transaction(async (tx) => {
      await tx.attachment.deleteMany({
        where: { annotation: { mediaId: { in: mediaIds } } }
      });
      await tx.annotation.deleteMany({
        where: { mediaId: { in: mediaIds } }
      });
      await tx.shareLink.deleteMany({
        where: { mediaId: { in: mediaIds } }
      });
      await tx.mediaFile.deleteMany({
        where: { mediaId: { in: mediaIds } }
      });
      await tx.media.deleteMany({
        where: { id: { in: mediaIds } }
      });
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.trash.clear",
      entityType: "Project",
      entityId: projectId,
      meta: { mediaIds, count: mediaIds.length }
    });

    return reply.send({ ok: true, deleted: mediaIds.length });
  });

  app.get("/media/:mediaId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const media = await prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        projectId: true,
        folderId: true,
        title: true,
        status: true,
        reviewStatus: true,
        versionIndex: true,
        seriesId: true,
        createdAt: true,
        updatedAt: true,
        files: {
          select: {
            id: true,
            originalObjectKey: true,
            derivedPrefix: true,
            mode: true,
            durationMs: true,
            width: true,
            height: true,
            sizeBytes: true,
            bitrateKbps: true,
            frameCount: true,
            createdAt: true
          },
          orderBy: { createdAt: "desc" }
        }
      }
    });
    return { media };
  });

  app.get("/media/:mediaId/preview", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const query = PreviewQuerySchema.parse(req.query ?? {});
    const media = await prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        title: true,
        files: {
          select: {
            originalObjectKey: true,
            createdAt: true
          },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    const file = media?.files[0];
    if (!media || !file?.originalObjectKey) {
      return reply.code(404).send({ error: "preview_not_ready" });
    }

    const url = await presignGetObject({
      bucket: env.S3_BUCKET_ORIGINAL,
      objectKey: file.originalObjectKey
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.preview",
      entityType: "Media",
      entityId: mediaId,
      meta: { objectKey: file.originalObjectKey }
    });

    return reply.send({
      preview: {
        url,
        fileName: media.title,
        inline: query.inline
      }
    });
  });

  app.get("/media/:mediaId/download", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const query = DownloadQuerySchema.parse(req.query ?? {});
    const media = await prisma.media.findUnique({
      where: { id: mediaId },
      select: {
        id: true,
        title: true,
        files: {
          select: {
            originalObjectKey: true,
            createdAt: true
          },
          orderBy: { createdAt: "desc" },
          take: 1
        }
      }
    });

    const file = media?.files[0];
    if (!media || !file?.originalObjectKey) {
      return reply.code(404).send({ error: "not_found" });
    }

    const url = await presignGetObject({
      bucket: env.S3_BUCKET_ORIGINAL,
      objectKey: file.originalObjectKey
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.download",
      entityType: "Media",
      entityId: mediaId,
      meta: { objectKey: file.originalObjectKey, inline: query.inline }
    });

    return reply.send({
      download: {
        url,
        fileName: media.title,
        inline: query.inline
      }
    });
  });

  app.post(
    "/media/:mediaId/upload/presign",
    { preHandler: requireUser },
    async (req, reply) => {
      const userId = getUserId(req);
      const mediaId = (req.params as any).mediaId as string;
      const access = await assertMediaAccess(userId, mediaId);
      if (!access) return reply.code(404).send({ error: "not_found" });

      const input = PresignVideoSchema.parse(req.body);
      const ext = input.filename.includes(".")
        ? input.filename.split(".").pop()!.slice(0, 10)
        : "bin";

      const objectKey = `original/${mediaId}/${nanoid(16)}.${ext}`;
      const url = await presignPutObject({
        bucket: env.S3_BUCKET_ORIGINAL,
        objectKey,
        contentType: input.contentType
      });

      await auditLog({
        req,
        actorUserId: userId,
        action: "media.presign_upload",
        entityType: "Media",
        entityId: mediaId,
        meta: { objectKey, contentType: input.contentType, mode: input.mode }
      });

      return reply.send({
        upload: {
          method: "PUT",
          url,
          objectKey,
          bucket: env.S3_BUCKET_ORIGINAL,
          mode: input.mode
        }
      });
    }
  );

  app.post("/media/:mediaId/process", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const input = EnqueueSchema.parse(req.body);

    const metadata = await readMediaMetadata(input.originalObjectKey);

    await prisma.mediaFile.upsert({
      where: {
        mediaId_originalObjectKey: {
          mediaId,
          originalObjectKey: input.originalObjectKey
        }
      },
      update: {
        derivedPrefix: null,
        mode: input.mode,
        durationMs: metadata.durationMs,
        width: metadata.width,
        height: metadata.height,
        sizeBytes: metadata.sizeBytes,
        bitrateKbps: metadata.bitrateKbps,
        frameCount: metadata.frameCount
      },
      create: {
        mediaId,
        originalObjectKey: input.originalObjectKey,
        derivedPrefix: null,
        mode: input.mode,
        durationMs: metadata.durationMs,
        width: metadata.width,
        height: metadata.height,
        sizeBytes: metadata.sizeBytes,
        bitrateKbps: metadata.bitrateKbps,
        frameCount: metadata.frameCount
      }
    });

    if (!mediaQueue) {
      await prisma.media.update({
        where: { id: mediaId },
        data: { status: "uploaded" }
      });
      return reply.send({ ok: true, queued: false, metadata });
    }

    await prisma.media.update({
      where: { id: mediaId },
      data: { status: "queued" }
    });

    await mediaQueue.add("transcode", {
      mediaId,
      originalObjectKey: input.originalObjectKey,
      mode: input.mode
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.enqueue",
      entityType: "Media",
      entityId: mediaId,
      meta: { mode: input.mode }
    });

    return reply.send({ ok: true, queued: true, metadata });
  });
}
