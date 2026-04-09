import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { getUserId, requireUser } from "../auth/requireUser";
import { auditLog } from "../audit";

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

const CreateAnnotationSchema = z.object({
  timestampMs: z.number().int().min(0),
  type: z.enum(["pin", "rect", "text"]),
  rect: RectSchema.optional(),
  body: z.string().max(5000).default(""),
  attachments: z.array(AttachmentSchema).default([])
});

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

export async function annotationRoutes(app: FastifyInstance) {
  app.get("/media/:mediaId/annotations", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const annotations = await prisma.annotation.findMany({
      where: { mediaId, deletedAt: null },
      orderBy: { timestampMs: "asc" },
      select: {
        id: true,
        projectId: true,
        mediaId: true,
        authorId: true,
        timestampMs: true,
        type: true,
        rect: true,
        body: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, username: true, displayName: true } },
        attachments: {
          select: { id: true, kind: true, objectKey: true, mimeType: true, width: true, height: true, createdAt: true }
        }
      }
    });

    return { annotations };
  });

  app.get(
    "/media/:mediaId/annotations/export.json",
    { preHandler: requireUser },
    async (req, reply) => {
      const userId = getUserId(req);
      const mediaId = (req.params as any).mediaId as string;
      const access = await assertMediaAccess(userId, mediaId);
      if (!access) return reply.code(404).send({ error: "not_found" });

      const annotations = await prisma.annotation.findMany({
        where: { mediaId, deletedAt: null },
        orderBy: { timestampMs: "asc" },
        select: {
          id: true,
          timestampMs: true,
          type: true,
          rect: true,
          body: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, username: true, displayName: true } },
          attachments: { select: { id: true, kind: true, objectKey: true, mimeType: true, width: true, height: true } }
        }
      });

      reply.header("content-type", "application/json; charset=utf-8");
      return reply.send({ mediaId, annotations });
    }
  );

  app.post("/media/:mediaId/annotations", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await assertMediaAccess(userId, mediaId);
    if (!access) return reply.code(404).send({ error: "not_found" });

    const input = CreateAnnotationSchema.parse(req.body);

    const ann = await prisma.annotation.create({
      data: {
        projectId: access.projectId,
        mediaId,
        authorId: userId,
        timestampMs: input.timestampMs,
        type: input.type,
        rect: input.rect ?? null,
        body: input.body,
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
      select: { id: true }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "annotation.create",
      entityType: "Annotation",
      entityId: ann.id,
      meta: { mediaId, timestampMs: input.timestampMs }
    });

    return reply.code(201).send({ id: ann.id });
  });
}
