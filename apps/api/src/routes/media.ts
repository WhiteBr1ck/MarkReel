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
        owner: {
          select: {
            id: true,
            username: true,
            displayName: true
          }
        }
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

    await auditLog({
      req,
      actorUserId: userId,
      action: input.rating !== undefined ? "media.rate" : "media.update",
      entityType: "Media",
      entityId: media.id,
      meta: { title: media.title, folderId: media.folderId, rating: input.rating }
    });

    return reply.send({ media: { ...media, ...rating } });
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
        creator: media.project.owner
          ? {
              id: media.project.owner.id,
              username: media.project.owner.username,
              displayName: media.project.owner.displayName
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
    if (!media || !file?.originalObjectKey) {
      return reply.code(404).send({ error: "preview_not_ready" });
    }

    const previewTarget =
      file.mode === "compress"
        ? media.status === "failed"
          ? null
          : file.derivedPrefix && media.status === "ready"
            ? {
                bucket: env.S3_BUCKET_DERIVED,
                objectKey: file.derivedPrefix
              }
            : null
        : {
            bucket: env.S3_BUCKET_ORIGINAL,
            objectKey: file.originalObjectKey
          };

    if (file.mode === "compress" && media.status === "failed") {
      return reply.code(409).send({ error: "processing_failed" });
    }

    if (!previewTarget) {
      return reply.code(404).send({ error: "preview_not_ready" });
    }

    const url = await presignGetObject(previewTarget);

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.preview",
      entityType: "Media",
      entityId: mediaId,
      meta: { objectKey: previewTarget.objectKey, bucket: previewTarget.bucket }
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
    const transcode = input.mode === "compress" ? input.transcode : undefined;

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

    if (input.mode === "original") {
      await prisma.media.update({
        where: { id: mediaId },
        data: { status: "ready" }
      });
      return reply.send({ ok: true, queued: false, metadata });
    }

    if (!mediaQueue) {
      await prisma.media.update({
        where: { id: mediaId },
        data: { status: "failed" }
      });
      return reply.code(503).send({ error: "queue_unavailable" });
    }

    try {
      await mediaQueue.add("transcode", {
        mediaId,
        originalObjectKey: input.originalObjectKey,
        mode: input.mode,
        transcode
      });
    } catch {
      await prisma.media.update({
        where: { id: mediaId },
        data: { status: "failed" }
      });
      return reply.code(503).send({ error: "queue_unavailable" });
    }

    await prisma.media.update({
      where: { id: mediaId },
      data: { status: "queued" }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media.enqueue",
      entityType: "Media",
      entityId: mediaId,
      meta: { mode: input.mode, transcode }
    });

    return reply.send({ ok: true, queued: true, metadata });
  });
}
