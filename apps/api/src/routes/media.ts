import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { prisma } from "../db";
import { getUserId, requireUser } from "../auth/requireUser";
import { presignGetObject, presignPutObject, statObject, getObjectStream, putObjectStream } from "../s3";
import { putRequestBodyObject } from "../uploadProxy";
import { env } from "../env";
import { auditLog } from "../audit";
import { getMediaAccess, getProjectAccess, hasCapability, hasMediaCapability } from "../access";
import { mediaQueue } from "../queue";

const CreateMediaSchema = z.object({
  title: z.string().min(1).max(200),
  folderId: z.string().optional().nullable(),
  seriesId: z.string().optional()
});

const UpdateMediaSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().trim().min(1).nullable().optional(),
  rating: z.number().int().min(1).max(5).nullable().optional()
});

const PresignVideoSchema = z.object({
  filename: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120),
  mode: z.enum(["original", "compress"]).default("compress")
});

const TranscodeSchema = z.object({
  resolution: z.enum(["1080p", "720p"]).optional(),
  fps: z.union([z.literal("source"), z.literal(24), z.literal(25), z.literal(30), z.literal(60)]).optional()
});

const EnqueueSchema = z.object({
  mode: z.enum(["original", "compress"]),
  originalObjectKey: z.string().min(1),
  transcode: TranscodeSchema.optional()
});

const ServerImportListSchema = z.object({
  path: z.string().optional().default("")
});

const ServerImportSchema = z.object({
  path: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  folderId: z.string().optional().nullable(),
  mode: z.enum(["original", "compress"]).default("compress"),
  transcode: TranscodeSchema.optional()
});

const MediaPermissionSchema = z.enum(["manage", "annotate", "view"]);
const MediaPermissionSubjectSchema = z.enum(["organization", "invited_user", "public"]);

const MediaPermissionGrantSchema = z.object({
  subjectType: MediaPermissionSubjectSchema,
  subjectUserId: z.string().nullable().optional(),
  permission: MediaPermissionSchema
});

const ReplaceMediaPermissionsSchema = z.object({
  grants: z.array(MediaPermissionGrantSchema)
});

const PreviewQuerySchema = z.object({
  inline: z.coerce.boolean().optional().default(true)
});

const DownloadQuerySchema = z.object({
  inline: z.coerce.boolean().optional().default(false)
});

const execFileAsync = promisify(execFile);

function timeoutAfter(ms: number, message: string) {
  return new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}

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

  const object = await getObjectStream({
    bucket: env.S3_BUCKET_ORIGINAL,
    objectKey
  });

  if (!object.body) throw new Error(`Missing readable body for s3://${env.S3_BUCKET_ORIGINAL}/${objectKey}`);

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "markreel-api-"));
  const inputPath = path.join(tempDir, "metadata-source");

  let stdout: string;
  try {
    await pipeline(object.body, createWriteStream(inputPath));
    const result = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      inputPath
    ]);
    stdout = result.stdout;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }

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

async function getPreviewTargetForMedia(mediaId: string) {
  const media = await prisma.media.findUnique({
    where: { id: mediaId },
    select: {
      id: true,
      title: true,
      status: true,
      files: {
        select: {
          originalObjectKey: true,
          derivedPrefix: true,
          mode: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    }
  });

  const file = media?.files[0];
  if (!media || !file?.originalObjectKey) return null;
  if (file.mode === "compress" && media.status === "failed") return { failed: true as const };

  const target =
    file.mode === "compress"
      ? file.derivedPrefix && media.status === "ready"
        ? { bucket: env.S3_BUCKET_DERIVED, objectKey: file.derivedPrefix }
        : null
      : { bucket: env.S3_BUCKET_ORIGINAL, objectKey: file.originalObjectKey };

  if (!target) return null;
  return { media, target };
}

async function assertProjectAccess(userId: string, projectId: string, capability: "project:view" | "project:upload" | "project:manage_members" | "project:edit_assets" = "project:view") {
  const access = await getProjectAccess({ userId, projectId });
  return access && hasCapability(access, capability) ? access : null;
}

async function readLocalMediaMetadata(filePath: string, sizeBytes?: number) {
  const result = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    filePath
  ], { timeout: 30000, windowsHide: true });

  const parsed = FfprobeResultSchema.parse(JSON.parse(result.stdout));
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
    sizeBytes,
    durationMs: durationSeconds ? Math.max(1, Math.round(durationSeconds * 1000)) : undefined,
    width: videoStream?.width,
    height: videoStream?.height,
    bitrateKbps: bitrate ? Math.max(1, Math.round(bitrate / 1000)) : undefined,
    frameCount: explicitFrames ? Math.max(1, Math.round(explicitFrames)) : derivedFrameCount ? Math.max(1, derivedFrameCount) : undefined
  };
}

function normalizeRelativeImportPath(value: string) {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized === "." ? "" : normalized;
}

async function resolveServerImportPath(relativePath: string) {
  if (!env.MARKREEL_SERVER_IMPORT_ROOT) return null;
  const root = path.resolve(env.MARKREEL_SERVER_IMPORT_ROOT);
  const requested = path.resolve(root, normalizeRelativeImportPath(relativePath));
  const relative = path.relative(root, requested);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return { root, absolutePath: requested, relativePath: relative === "" ? "" : normalizeRelativeImportPath(relative) };
}

function stripFileExtension(fileName: string) {
  const ext = path.extname(fileName);
  return ext ? fileName.slice(0, -ext.length) : fileName;
}

function appendTitleSuffix(baseTitle: string, suffix: string) {
  const maxBaseLength = Math.max(1, 200 - suffix.length);
  const trimmedBase = baseTitle.length > maxBaseLength ? baseTitle.slice(0, maxBaseLength).trimEnd() : baseTitle;
  return `${trimmedBase}${suffix}`;
}

async function makeUniqueMediaTitle(args: {
  projectId: string;
  folderId: string | null | undefined;
  title: string;
  excludeMediaId?: string;
}) {
  const baseTitle = (args.title.trim() || "Untitled").slice(0, 200);
  const existing = await prisma.media.findMany({
    where: {
      projectId: args.projectId,
      folderId: args.folderId ?? null,
      deletedAt: null,
      ...(args.excludeMediaId ? { id: { not: args.excludeMediaId } } : {})
    },
    select: { title: true }
  });
  const titles = new Set(existing.map((item) => item.title));
  if (!titles.has(baseTitle)) return baseTitle;

  for (let index = 2; index < 10000; index += 1) {
    const candidate = appendTitleSuffix(baseTitle, ` (${index})`);
    if (!titles.has(candidate)) return candidate;
  }

  return appendTitleSuffix(baseTitle, ` (${Date.now()})`);
}

async function registerMediaFile(args: {
  mediaId: string;
  objectKey: string;
  mode: "original" | "compress";
  metadata: Awaited<ReturnType<typeof readLocalMediaMetadata>>;
  transcode?: z.infer<typeof TranscodeSchema>;
}) {
  await prisma.mediaFile.upsert({
    where: {
      mediaId_originalObjectKey: {
        mediaId: args.mediaId,
        originalObjectKey: args.objectKey
      }
    },
    update: {
      derivedPrefix: null,
      mode: args.mode,
      durationMs: args.metadata.durationMs,
      width: args.metadata.width,
      height: args.metadata.height,
      sizeBytes: args.metadata.sizeBytes,
      bitrateKbps: args.metadata.bitrateKbps,
      frameCount: args.metadata.frameCount
    },
    create: {
      mediaId: args.mediaId,
      originalObjectKey: args.objectKey,
      derivedPrefix: null,
      mode: args.mode,
      durationMs: args.metadata.durationMs,
      width: args.metadata.width,
      height: args.metadata.height,
      sizeBytes: args.metadata.sizeBytes,
      bitrateKbps: args.metadata.bitrateKbps,
      frameCount: args.metadata.frameCount
    }
  });

  if (args.mode === "original") {
    await prisma.media.update({
      where: { id: args.mediaId },
      data: { status: "ready" }
    });
    return { queued: false };
  }

  if (!mediaQueue) {
    await prisma.media.update({
      where: { id: args.mediaId },
      data: { status: "failed" }
    });
    return { queued: false, error: "queue_unavailable" as const };
  }

  try {
    await mediaQueue.add("transcode", {
      mediaId: args.mediaId,
      originalObjectKey: args.objectKey,
      mode: args.mode,
      transcode: args.transcode
    });
  } catch {
    await prisma.media.update({
      where: { id: args.mediaId },
      data: { status: "failed" }
    });
    return { queued: false, error: "queue_unavailable" as const };
  }

  await prisma.media.update({
    where: { id: args.mediaId },
    data: { status: "queued" }
  });

  return { queued: true };
}

async function assertMediaAccess(userId: string, mediaId: string, capability: "media:view" | "media:manage" = "media:view") {
  const result = await getMediaAccess({ userId, mediaId });
  if (!result || !hasMediaCapability(result.access, capability)) return null;
  return { id: result.media.id, projectId: result.media.projectId, mediaAccess: result.access };
}

async function assertMediaAccessIncludingDeleted(userId: string, mediaId: string, capability: "media:view" | "media:manage" = "media:view") {
  const result = await getMediaAccess({ userId, mediaId, includeDeleted: true });
  if (!result || !hasMediaCapability(result.access, capability)) return null;
  return { id: result.media.id, projectId: result.media.projectId, deletedAt: result.media.deletedAt, mediaAccess: result.access };
}

async function assertFolderAccess(projectId: string, folderId: string | null | undefined) {
  if (!folderId) return true;
  const folder = await prisma.projectFolder.findFirst({
    where: { id: folderId, projectId, deletedAt: null },
    select: { id: true }
  });
  return !!folder;
}

async function getRatingSummary(mediaId: string, userId: string) {
  const [aggregate, mine] = await Promise.all([
    prisma.mediaRating.aggregate({
      where: { mediaId },
      _avg: { value: true },
      _count: { _all: true }
    }),
    prisma.mediaRating.findUnique({
      where: { mediaId_userId: { mediaId, userId } },
      select: { value: true }
    })
  ]);

  return {
    myRating: mine?.value ?? null,
    averageRating: aggregate._avg.value == null ? null : Number(aggregate._avg.value.toFixed(1)),
    ratingCount: aggregate._count._all ?? 0
  };
}

function mediaSelect(userId: string) {
  return {
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
    project: {
      select: {
        organizationId: true
      }
    },
    creator: {
      select: {
        id: true,
        username: true,
        displayName: true
      }
    },
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
    },
    ratings: {
      where: { userId },
      select: { value: true },
      take: 1
    },
    _count: {
      select: { ratings: true }
    }
  } as const;
}

export async function mediaRoutes(app: FastifyInstance) {
  app.post(
    "/projects/:projectId/media",
    { preHandler: requireUser },
    async (req, reply) => {
      const userId = getUserId(req);
      const projectId = (req.params as any).projectId as string;
      const input = CreateMediaSchema.parse(req.body);

      const ok = await assertProjectAccess(userId, projectId, "project:upload");
      if (!ok) return reply.code(404).send({ error: "not_found" });

      const folderOk = await assertFolderAccess(projectId, input.folderId ?? null);
      if (!folderOk) return reply.code(404).send({ error: "folder_not_found" });

      const title = await makeUniqueMediaTitle({ projectId, folderId: input.folderId ?? null, title: input.title });

      const media = await prisma.media.create({
        data: {
          projectId,
          creatorId: userId,
          folderId: input.folderId ?? null,
          title,
          seriesId: input.seriesId ?? null,
          permissionGrants: {
            create: ["manage", "annotate", "view"].map((permission) => ({ subjectType: "creator", subjectKey: "", permission: permission as any }))
          }
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

      return reply.code(201).send({
        media: {
          ...media,
          myRating: null,
          averageRating: null,
          ratingCount: 0
        }
      });
    }
  );

  app.get("/media/:mediaId/permissions", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId, "media:view");
    if (!access) return reply.code(404).send({ error: "not_found" });

    const media = await prisma.media.findFirst({
      where: { id: mediaId, deletedAt: null },
      select: { id: true, projectId: true, creatorId: true, project: { select: { organizationId: true } } }
    });
    if (!media) return reply.code(404).send({ error: "not_found" });

    const grants = await prisma.mediaPermissionGrant.findMany({
      where: { mediaId },
      orderBy: [{ subjectType: "asc" }, { createdAt: "asc" }],
      include: { subjectUser: { select: { id: true, username: true, displayName: true, avatarPreset: true } } }
    });

    return {
      media: { id: media.id, projectId: media.projectId, creatorId: media.creatorId, organizationId: media.project.organizationId },
      grants: grants.map((grant) => ({
        id: grant.id,
        subjectType: grant.subjectType,
        subjectUserId: grant.subjectUserId,
        permission: grant.permission,
        user: grant.subjectUser,
        locked: grant.subjectType === "creator"
      }))
    };
  });

  app.put("/media/:mediaId/permissions", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const input = ReplaceMediaPermissionsSchema.parse(req.body);
    const access = await assertMediaAccess(userId, mediaId, "media:manage");
    if (!access) return reply.code(404).send({ error: "not_found" });

    const media = await prisma.media.findFirst({
      where: { id: mediaId, deletedAt: null },
      select: { creatorId: true, project: { select: { organizationId: true } } }
    });
    if (!media) return reply.code(404).send({ error: "not_found" });

    const organizationUserIds = media.project.organizationId
      ? new Set((await prisma.organizationMember.findMany({ where: { organizationId: media.project.organizationId }, select: { userId: true } })).map((member) => member.userId))
      : new Set<string>();

    for (const grant of input.grants) {
      if (grant.subjectType === "organization" && !media.project.organizationId) return reply.code(400).send({ error: "project_without_organization" });
      if (grant.subjectType === "invited_user") {
        if (!grant.subjectUserId) return reply.code(400).send({ error: "missing_subject_user" });
        if (grant.subjectUserId === media.creatorId) return reply.code(400).send({ error: "creator_permission_locked" });
        if (media.project.organizationId && !organizationUserIds.has(grant.subjectUserId)) return reply.code(400).send({ error: "user_not_in_organization" });
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.mediaPermissionGrant.deleteMany({ where: { mediaId, subjectType: { not: "creator" } } });
      await tx.mediaPermissionGrant.createMany({
        data: input.grants.map((grant) => ({
          mediaId,
          subjectType: grant.subjectType,
          subjectKey: grant.subjectType === "invited_user" ? grant.subjectUserId ?? "" : "",
          subjectUserId: grant.subjectType === "invited_user" ? grant.subjectUserId ?? null : null,
          permission: grant.permission
        }))
      });
      await Promise.all(["manage", "annotate", "view"].map((permission) => tx.mediaPermissionGrant.upsert({
        where: { mediaId_subjectType_subjectKey_permission: { mediaId, subjectType: "creator", subjectKey: "", permission: permission as any } },
        update: {},
        create: { mediaId, subjectType: "creator", subjectKey: "", subjectUserId: null, permission: permission as any }
      })));
    });

    await auditLog({ req, actorUserId: userId, action: "media_permissions.replace", entityType: "Media", entityId: mediaId, meta: { grants: input.grants } });
    return { ok: true };
  });

  app.patch("/media/:mediaId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const input = UpdateMediaSchema.parse(req.body);
    const access = await assertMediaAccess(userId, mediaId, input.rating !== undefined && input.title === undefined && input.folderId === undefined ? "media:view" : "media:manage");
    if (!access) return reply.code(404).send({ error: "not_found" });

    if (input.folderId !== undefined) {
      const folderOk = await assertFolderAccess(access.projectId, input.folderId);
      if (!folderOk) return reply.code(404).send({ error: "folder_not_found" });
    }

    const currentMedia = input.title !== undefined || input.folderId !== undefined
      ? await prisma.media.findFirst({ where: { id: mediaId, deletedAt: null }, select: { projectId: true, folderId: true, title: true } })
      : null;
    const targetFolderId = input.folderId !== undefined ? input.folderId : currentMedia?.folderId;
    const title = currentMedia && (input.title !== undefined || input.folderId !== undefined)
      ? await makeUniqueMediaTitle({ projectId: access.projectId, folderId: targetFolderId ?? null, title: input.title ?? currentMedia.title, excludeMediaId: mediaId })
      : undefined;

    const media = await prisma.media.update({
      where: { id: mediaId },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(input.folderId !== undefined ? { folderId: input.folderId } : {})
      },
      select: { id: true, title: true, folderId: true }
    });

    if (input.rating !== undefined) {
      if (input.rating === null) {
        await prisma.mediaRating.deleteMany({ where: { mediaId, userId } });
      } else {
        await prisma.mediaRating.upsert({
          where: { mediaId_userId: { mediaId, userId } },
          update: { value: input.rating },
          create: { mediaId, userId, value: input.rating }
        });
      }
    }

    const rating = await getRatingSummary(mediaId, userId);
    const fullMedia = await prisma.media.findUnique({
      where: { id: mediaId },
      select: mediaSelect(userId)
    });
    if (!fullMedia) return reply.code(404).send({ error: "not_found" });

    await auditLog({
      req,
      actorUserId: userId,
      action: input.rating !== undefined ? "media.rate" : "media.update",
      entityType: "Media",
      entityId: media.id,
      meta: { title: media.title, folderId: media.folderId, rating: input.rating }
    });

    return reply.send({
      media: {
        id: fullMedia.id,
        projectId: fullMedia.projectId,
        folderId: fullMedia.folderId,
        title: fullMedia.title,
        status: fullMedia.status,
        reviewStatus: fullMedia.reviewStatus,
        versionIndex: fullMedia.versionIndex,
        seriesId: fullMedia.seriesId,
        createdAt: fullMedia.createdAt,
        updatedAt: fullMedia.updatedAt,
        capabilities: access.mediaAccess.capabilities,
        projectCapabilities: access.mediaAccess.projectAccess.capabilities,
        organizationId: fullMedia.project.organizationId,
        creator: fullMedia.creator
          ? {
              id: fullMedia.creator.id,
              username: fullMedia.creator.username,
              displayName: fullMedia.creator.displayName
            }
          : null,
        files: fullMedia.files,
        ...rating
      }
    });
  });

  app.delete("/media/:mediaId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId, "media:manage");
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
    const ok = await assertProjectAccess(userId, projectId, "project:view");
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
    const access = await assertMediaAccessIncludingDeleted(userId, mediaId, "media:manage");
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
    const ok = await assertProjectAccess(userId, projectId, "project:manage_members");
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
      await tx.mediaRating.deleteMany({
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
      select: mediaSelect(userId)
    });
    if (!media) return reply.code(404).send({ error: "not_found" });

    const rating = await getRatingSummary(mediaId, userId);

    return {
      media: {
        id: media.id,
        projectId: media.projectId,
        folderId: media.folderId,
        title: media.title,
        status: media.status,
        reviewStatus: media.reviewStatus,
        versionIndex: media.versionIndex,
        seriesId: media.seriesId,
        createdAt: media.createdAt,
        updatedAt: media.updatedAt,
        capabilities: access.mediaAccess.capabilities,
        projectCapabilities: access.mediaAccess.projectAccess.capabilities,
        organizationId: media.project.organizationId,
        creator: media.creator
          ? {
              id: media.creator.id,
              username: media.creator.username,
              displayName: media.creator.displayName
            }
          : null,
        files: media.files,
        ...rating
      }
    };
  });

  app.get("/media/:mediaId/preview", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const query = PreviewQuerySchema.parse(req.query ?? {});
    const result = await getPreviewTargetForMedia(mediaId);
    if (!result) return reply.code(404).send({ error: "preview_not_ready" });
    if ("failed" in result) return reply.code(409).send({ error: "processing_failed" });

    const url = await presignGetObject(result.target);

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.preview",
      entityType: "Media",
      entityId: mediaId,
      meta: { objectKey: result.target.objectKey, bucket: result.target.bucket }
    });

    return reply.send({
      preview: {
        url,
        fileName: result.media.title,
        inline: query.inline
      }
    });
  });

  app.get("/media/:mediaId/preview/file", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const result = await getPreviewTargetForMedia(mediaId);
    if (!result) return reply.code(404).send({ error: "preview_not_ready" });
    if ("failed" in result) return reply.code(409).send({ error: "processing_failed" });

    const range = req.headers.range;
    const initialObject = await getObjectStream(result.target);
    if (!initialObject.body) return reply.code(404).send({ error: "preview_not_ready" });

    if (range && initialObject.contentLength) {
      initialObject.body.destroy();
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) return reply.code(416).send();
      const total = initialObject.contentLength;
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : total - 1;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) return reply.code(416).send();
      const rangedObject = await getObjectStream({ ...result.target, range: `bytes=${start}-${Math.min(end, total - 1)}` });
      if (!rangedObject.body) return reply.code(404).send({ error: "preview_not_ready" });
      reply.code(206);
      reply.header("content-range", `bytes ${start}-${Math.min(end, total - 1)}/${total}`);
      reply.header("content-length", String(Math.min(end, total - 1) - start + 1));
      reply.header("content-type", rangedObject.contentType ?? initialObject.contentType ?? "video/mp4");
      reply.header("accept-ranges", "bytes");
      return reply.send(rangedObject.body);
    }

    reply.header("content-type", initialObject.contentType ?? "video/mp4");
    if (initialObject.contentLength) reply.header("content-length", String(initialObject.contentLength));
    if (initialObject.etag) reply.header("etag", initialObject.etag);
    if (initialObject.lastModified) reply.header("last-modified", initialObject.lastModified.toUTCString());
    reply.header("accept-ranges", "bytes");

    return reply.send(initialObject.body);
  });

  app.get("/media/:mediaId/processing-status", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const media = await prisma.media.findUnique({
      where: { id: mediaId },
      select: { id: true, status: true, updatedAt: true }
    });
    if (!media) return reply.code(404).send({ error: "not_found" });

    let processing: { state: string; progress: number | null; failedReason: string | null } | null = null;
    if (mediaQueue) {
      const jobs = await mediaQueue.getJobs(["waiting", "delayed", "active", "completed", "failed"], 0, 50, false).catch(() => []);
      const job = jobs.find((item) => item.data.mediaId === mediaId) ?? null;
      if (job) {
        const state = await job.getState().catch(() => "unknown");
        const rawProgress = job.progress;
        processing = {
          state,
          progress: typeof rawProgress === "number" ? rawProgress : null,
          failedReason: job.failedReason || null
        };
      }
    }

    return {
      media: {
        id: media.id,
        status: media.status,
        updatedAt: media.updatedAt
      },
      processing
    };
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
      objectKey: file.originalObjectKey,
      req
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
      const access = await assertMediaAccess(userId, mediaId, "media:manage");
      if (!access) return reply.code(404).send({ error: "not_found" });

      const input = PresignVideoSchema.parse(req.body);
      const ext = input.filename.includes(".")
        ? input.filename.split(".").pop()!.slice(0, 10)
        : "bin";

      const objectKey = `original/${mediaId}/${nanoid(16)}.${ext}`;
      const url = await presignPutObject({
        bucket: env.S3_BUCKET_ORIGINAL,
        objectKey,
        contentType: input.contentType,
        req
      });
      const proxyUrl = `/api/objects/${encodeURIComponent(env.S3_BUCKET_ORIGINAL)}/${encodeURIComponent(objectKey)}`;

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
          proxyUrl,
          objectKey,
          bucket: env.S3_BUCKET_ORIGINAL,
          mode: input.mode
        }
      });
    }
  );

  app.put("/media/:mediaId/upload/file", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId, "media:manage");
    if (!access) return reply.code(404).send({ error: "not_found" });

    const objectKey = String((req.query as any).objectKey ?? "");
    if (!objectKey.startsWith(`original/${mediaId}/`)) {
      return reply.code(400).send({ error: "invalid_object_key" });
    }

    await putRequestBodyObject({
      req,
      bucket: env.S3_BUCKET_ORIGINAL,
      objectKey,
      contentType: req.headers["content-type"] ?? undefined
    });

    return reply.send({ ok: true, objectKey });
  });

  app.post("/media/:mediaId/process", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId, "media:manage");
    if (!access) return reply.code(404).send({ error: "not_found" });

    const input = EnqueueSchema.parse(req.body);
    const transcode = input.mode === "compress" ? input.transcode : undefined;

    const metadata = await readMediaMetadata(input.originalObjectKey);
    const registered = await registerMediaFile({
      mediaId,
      objectKey: input.originalObjectKey,
      mode: input.mode,
      metadata,
      transcode
    });

    if (registered.error) return reply.code(503).send({ error: registered.error });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.enqueue",
      entityType: "Media",
      entityId: mediaId,
      meta: { mode: input.mode, transcode }
    });

    return reply.send({ ok: true, queued: registered.queued, metadata });
  });

  app.get("/server-import/browse", { preHandler: requireUser }, async (req, reply) => {
    const input = ServerImportListSchema.parse(req.query ?? {});
    const resolved = await resolveServerImportPath(input.path);
    if (!resolved) return reply.code(env.MARKREEL_SERVER_IMPORT_ROOT ? 400 : 404).send({ error: env.MARKREEL_SERVER_IMPORT_ROOT ? "invalid_import_path" : "server_import_disabled" });

    let entries: Array<{ name: string; path: string; kind: "directory" | "file"; sizeBytes?: number; updatedAt: number }>;
    try {
      const dirents = await fs.readdir(resolved.absolutePath, { withFileTypes: true });
      entries = await Promise.all(
        dirents
          .filter((entry) => !entry.name.startsWith("."))
          .map(async (entry) => {
            const entryAbsolutePath = path.join(resolved.absolutePath, entry.name);
            const stat = await fs.stat(entryAbsolutePath);
            const entryRelativePath = normalizeRelativeImportPath(path.join(resolved.relativePath, entry.name));
            return {
              name: entry.name,
              path: entryRelativePath,
              kind: entry.isDirectory() ? "directory" as const : "file" as const,
              sizeBytes: entry.isFile() ? stat.size : undefined,
              updatedAt: stat.mtimeMs
            };
          })
      );
    } catch {
      return reply.code(404).send({ error: "import_path_not_found" });
    }

    return {
      rootEnabled: true,
      path: resolved.relativePath,
      parentPath: resolved.relativePath ? normalizeRelativeImportPath(path.dirname(resolved.relativePath)) : null,
      entries: entries.sort((a, b) => a.kind === b.kind ? a.name.localeCompare(b.name, "zh-CN") : a.kind === "directory" ? -1 : 1)
    };
  });

  app.post("/projects/:projectId/media/import/server", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const input = ServerImportSchema.parse(req.body);

    const access = await assertProjectAccess(userId, projectId, "project:upload");
    if (!access) return reply.code(404).send({ error: "not_found" });

    const folderOk = await assertFolderAccess(projectId, input.folderId ?? null);
    if (!folderOk) return reply.code(404).send({ error: "folder_not_found" });

    const resolved = await resolveServerImportPath(input.path);
    if (!resolved) return reply.code(env.MARKREEL_SERVER_IMPORT_ROOT ? 400 : 404).send({ error: env.MARKREEL_SERVER_IMPORT_ROOT ? "invalid_import_path" : "server_import_disabled" });

    let stat;
    try {
      stat = await fs.stat(resolved.absolutePath);
    } catch {
      return reply.code(404).send({ error: "import_path_not_found" });
    }
    if (!stat.isFile()) return reply.code(400).send({ error: "import_path_not_file" });

    let mediaId: string | undefined;
    try {
      const title = await makeUniqueMediaTitle({
        projectId,
        folderId: input.folderId ?? null,
        title: input.title ?? stripFileExtension(path.basename(resolved.absolutePath))
      });
      const transcode = input.mode === "compress" ? input.transcode : undefined;
      req.log.info({ importPath: resolved.relativePath, sizeBytes: stat.size }, "Starting server media import");
      const metadata = await readLocalMediaMetadata(resolved.absolutePath, stat.size);

      const media = await prisma.media.create({
        data: {
          projectId,
          creatorId: userId,
          folderId: input.folderId ?? null,
          title,
          permissionGrants: {
            create: ["manage", "annotate", "view"].map((permission) => ({ subjectType: "creator", subjectKey: "", permission: permission as any }))
          }
        },
        select: { id: true, projectId: true, folderId: true, title: true, status: true, reviewStatus: true, createdAt: true, updatedAt: true }
      });
      mediaId = media.id;

      const ext = path.extname(resolved.absolutePath).replace(/^\./, "").slice(0, 10) || "bin";
      const objectKey = `original/${media.id}/${nanoid(16)}.${ext}`;
      await Promise.race([
        putObjectStream({
          bucket: env.S3_BUCKET_ORIGINAL,
          objectKey,
          body: createReadStream(resolved.absolutePath),
          contentLength: stat.size
        }),
        timeoutAfter(120000, "server_import_storage_timeout")
      ]);

      const registered = await registerMediaFile({ mediaId: media.id, objectKey, mode: input.mode, metadata, transcode });
      if (registered.error) return reply.code(503).send({ error: registered.error });

      await auditLog({
        req,
        actorUserId: userId,
        action: "media.import_server",
        entityType: "Media",
        entityId: media.id,
        meta: { projectId, folderId: media.folderId, importPath: resolved.relativePath, mode: input.mode, transcode }
      });

      req.log.info({ mediaId: media.id, importPath: resolved.relativePath }, "Completed server media import");
      return reply.code(201).send({ media, upload: { objectKey, mode: input.mode }, queued: registered.queued, metadata });
    } catch (error) {
      req.log.error({ err: error, importPath: resolved.relativePath, mediaId }, "Server media import failed");
      if (mediaId) {
        await prisma.media.update({ where: { id: mediaId }, data: { status: "failed" } }).catch(() => undefined);
      }
      const message = error instanceof Error ? error.message : "server_import_failed";
      if (message.includes("timed out") || message.includes("timeout")) return reply.code(504).send({ error: "server_import_timeout" });
      return reply.code(500).send({ error: "server_import_failed" });
    }
  });
}

