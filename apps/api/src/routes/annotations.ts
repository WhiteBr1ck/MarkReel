import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { auditLog } from "../audit";
import { env } from "../env";
import { getUserId, requireUser } from "../auth/requireUser";
import { getAnnotationProjectAccess, getMediaProjectAccess, hasCapability } from "../access";
import { presignGetObject } from "../s3";

const RectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1)
});

const AttachmentSchema = z.object({
  kind: z.literal("image"),
  objectKey: z.string().min(1),
  mimeType: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional()
});

const AnnotationFilterSchema = z.object({
  status: z.enum(["all", "completed", "incomplete"]).optional().default("all")
});

const CreateAnnotationSchema = z.object({
  timestampMs: z.number().int().min(0),
  type: z.enum(["pin", "rect", "text"]),
  rect: RectSchema.optional(),
  body: z.string().max(5000).default(""),
  color: z.string().min(1).max(32).optional(),
  parentId: z.string().min(1).optional().nullable(),
  attachments: z.array(AttachmentSchema).default([])
});

const UpdateAnnotationSchema = z.object({
  timestampMs: z.number().int().min(0).optional(),
  body: z.string().max(5000).optional(),
  color: z.string().min(1).max(32).optional(),
  attachments: z.array(AttachmentSchema).optional()
});

const CompletionSchema = z.object({
  completed: z.boolean()
});

const annotationReplySelect = {
  id: true,
  projectId: true,
  mediaId: true,
  authorId: true,
  parentId: true,
  timestampMs: true,
  type: true,
  rect: true,
  body: true,
  color: true,
  completedAt: true,
  completedById: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, username: true, displayName: true, avatarObjectKey: true, avatarPreset: true } },
  completedBy: { select: { id: true, username: true, displayName: true, avatarObjectKey: true, avatarPreset: true } },
  attachments: {
    select: {
      id: true,
      kind: true,
      objectKey: true,
      mimeType: true,
      width: true,
      height: true,
      createdAt: true,
      annotationId: true
    }
  }
} satisfies Prisma.AnnotationSelect;

const annotationSelect = {
  id: true,
  projectId: true,
  mediaId: true,
  authorId: true,
  parentId: true,
  timestampMs: true,
  type: true,
  rect: true,
  body: true,
  color: true,
  completedAt: true,
  completedById: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, username: true, displayName: true, avatarObjectKey: true, avatarPreset: true } },
  completedBy: { select: { id: true, username: true, displayName: true, avatarObjectKey: true, avatarPreset: true } },
  attachments: {
    select: {
      id: true,
      kind: true,
      objectKey: true,
      mimeType: true,
      width: true,
      height: true,
      createdAt: true,
      annotationId: true
    }
  },
  replies: {
    where: { deletedAt: null },
    orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }],
    select: annotationReplySelect
  }
} satisfies Prisma.AnnotationSelect;

function getAnnotationWhere(mediaId: string, status: "all" | "completed" | "incomplete") {
  return {
    mediaId,
    deletedAt: null,
    parentId: null,
    ...(status === "completed"
      ? { completedAt: { not: null as null | Date } }
      : status === "incomplete"
        ? { completedAt: null }
        : {})
  };
}

async function assertMediaAccess(userId: string, mediaId: string) {
  const result = await getMediaProjectAccess({ userId, mediaId });
  if (!result || !hasCapability(result.access, "project:view")) return null;
  return { id: result.media.id, projectId: result.media.projectId, projectAccess: result.access };
}

async function assertAnnotationAccess(userId: string, annotationId: string) {
  const result = await getAnnotationProjectAccess({ userId, annotationId });
  if (!result || !hasCapability(result.access, "project:view")) return null;
  return { ...result.annotation, projectAccess: result.access };
}

async function hydrateAnnotationAvatarUrls<T extends Array<any>>(annotations: T): Promise<T> {
  const keys = new Map<string, string>();
  for (const annotation of annotations) {
    if (annotation.author?.avatarObjectKey) keys.set(annotation.author.avatarObjectKey, "");
    for (const reply of annotation.replies ?? []) {
      if (reply.author?.avatarObjectKey) keys.set(reply.author.avatarObjectKey, "");
    }
  }

  await Promise.all(
    [...keys.keys()].map(async (objectKey) => {
      keys.set(objectKey, await presignGetObject({ bucket: env.S3_BUCKET_ATTACHMENTS, objectKey, expiresInSeconds: 900 }));
    })
  );

  return annotations.map((annotation) => ({
    ...annotation,
    author: annotation.author
      ? { ...annotation.author, avatarUrl: annotation.author.avatarObjectKey ? keys.get(annotation.author.avatarObjectKey) ?? null : null }
      : annotation.author,
    replies: annotation.replies?.map((reply: any) => ({
      ...reply,
      author: reply.author
        ? { ...reply.author, avatarUrl: reply.author.avatarObjectKey ? keys.get(reply.author.avatarObjectKey) ?? null : null }
        : reply.author
    }))
  })) as T;
}

export async function annotationRoutes(app: FastifyInstance) {
  app.get("/media/:mediaId/annotations", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const query = AnnotationFilterSchema.parse(req.query ?? {});
    const annotations = await prisma.annotation.findMany({
      where: getAnnotationWhere(mediaId, query.status),
      orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }],
      select: annotationSelect
    });

    return { annotations: await hydrateAnnotationAvatarUrls(annotations) };
  });

  app.get(
    "/media/:mediaId/annotations/export.json",
    { preHandler: requireUser },
    async (req, reply) => {
      const userId = getUserId(req);
      const mediaId = (req.params as any).mediaId as string;
      const access = await assertMediaAccess(userId, mediaId);
      if (!access) return reply.code(404).send({ error: "not_found" });

      const query = AnnotationFilterSchema.parse(req.query ?? {});
      const annotations = await prisma.annotation.findMany({
        where: getAnnotationWhere(mediaId, query.status),
        orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }],
        select: annotationSelect
      });

      reply.header("content-type", "application/json; charset=utf-8");
      return reply.send({ mediaId, annotations: await hydrateAnnotationAvatarUrls(annotations) });
    }
  );

  app.post("/media/:mediaId/annotations", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const input = CreateAnnotationSchema.parse(req.body);
    if (!hasCapability(access.projectAccess, input.parentId ? "project:comment" : "project:annotate")) {
      return reply.code(403).send({ error: "forbidden" });
    }
    if (input.parentId) {
      const parent = await prisma.annotation.findFirst({
        where: { id: input.parentId, mediaId, deletedAt: null },
        select: { id: true }
      });
      if (!parent) return reply.code(404).send({ error: "parent_not_found" });
    }

    const ann = await prisma.annotation.create({
      data: {
        projectId: access.projectId,
        mediaId,
        authorId: userId,
        parentId: input.parentId ?? null,
        timestampMs: input.timestampMs,
        type: input.type,
        rect: input.rect ? (input.rect as Prisma.InputJsonValue) : Prisma.JsonNull,
        body: input.body,
        color: input.color ?? null,
        attachments: {
          create: input.attachments.map((a) => ({
            kind: a.kind,
            objectKey: a.objectKey,
            mimeType: a.mimeType ?? null,
            width: a.width ?? null,
            height: a.height ?? null
          }))
        }
      },
      select: { id: true, parentId: true }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: ann.parentId ? "annotation.reply" : "annotation.create",
      entityType: "Annotation",
      entityId: ann.id,
      meta: { mediaId, parentId: ann.parentId, hasAttachments: input.attachments.length > 0 }
    });

    return reply.code(201).send({ id: ann.id });
  });

  app.patch("/annotations/:annotationId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const annotationId = (req.params as any).annotationId as string;
    const access = await assertAnnotationAccess(userId, annotationId);
    if (!access) return reply.code(404).send({ error: "not_found" });
    if (access.authorId !== userId && !hasCapability(access.projectAccess, "project:edit_assets")) return reply.code(403).send({ error: "forbidden" });

    const input = UpdateAnnotationSchema.parse(req.body);
    const annotation = await prisma.annotation.update({
      where: { id: annotationId },
      data: {
        ...(input.timestampMs !== undefined ? { timestampMs: input.timestampMs } : {}),
        ...(input.body !== undefined ? { body: input.body } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.attachments !== undefined
          ? {
              attachments: {
                deleteMany: {},
                create: input.attachments.map((a) => ({
                  kind: a.kind,
                  objectKey: a.objectKey,
                  mimeType: a.mimeType ?? null,
                  width: a.width ?? null,
                  height: a.height ?? null
                }))
              }
            }
          : {})
      },
      select: { id: true }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "annotation.update",
      entityType: "Annotation",
      entityId: annotation.id,
      meta: { mediaId: access.mediaId }
    });

    return reply.send({ id: annotation.id });
  });

  app.patch("/annotations/:annotationId/completion", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const annotationId = (req.params as any).annotationId as string;
    const access = await assertAnnotationAccess(userId, annotationId);
    if (!access) return reply.code(404).send({ error: "not_found" });
    if (!hasCapability(access.projectAccess, "project:comment")) return reply.code(403).send({ error: "forbidden" });

    const input = CompletionSchema.parse(req.body);
    const annotation = await prisma.annotation.update({
      where: { id: annotationId },
      data: input.completed
        ? { completedAt: new Date(), completedById: userId }
        : { completedAt: null, completedById: null },
      select: { id: true, completedAt: true }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: input.completed ? "annotation.complete" : "annotation.reopen",
      entityType: "Annotation",
      entityId: annotation.id,
      meta: { mediaId: access.mediaId }
    });

    return reply.send({ id: annotation.id, completedAt: annotation.completedAt });
  });

  app.delete("/annotations/:annotationId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const annotationId = (req.params as any).annotationId as string;
    const access = await assertAnnotationAccess(userId, annotationId);
    if (!access) return reply.code(404).send({ error: "not_found" });
    if (access.authorId !== userId && !hasCapability(access.projectAccess, "project:edit_assets")) return reply.code(403).send({ error: "forbidden" });

    await prisma.$transaction(async (tx) => {
      await tx.annotation.updateMany({
        where: { parentId: annotationId, deletedAt: null },
        data: { deletedAt: new Date() }
      });
      await tx.annotation.update({
        where: { id: annotationId },
        data: { deletedAt: new Date() }
      });
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "annotation.delete",
      entityType: "Annotation",
      entityId: annotationId,
      meta: { mediaId: access.mediaId, parentId: access.parentId }
    });

    return reply.send({ ok: true });
  });

  app.get("/annotations/:annotationId/attachments/:attachmentId/preview", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const annotationId = (req.params as any).annotationId as string;
    const attachmentId = (req.params as any).attachmentId as string;
    const access = await assertAnnotationAccess(userId, annotationId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const attachment = await prisma.attachment.findFirst({
      where: { id: attachmentId, annotationId },
      select: { id: true, objectKey: true, annotationId: true }
    });
    if (!attachment) return reply.code(404).send({ error: "not_found" });

    const url = await presignGetObject({
      bucket: env.S3_BUCKET_ATTACHMENTS,
      objectKey: attachment.objectKey
    });

    return reply.send({
      preview: {
        url,
        attachmentId: attachment.id,
        objectKey: attachment.objectKey
      }
    });
  });
}
