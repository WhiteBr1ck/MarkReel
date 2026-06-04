import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { auditLog } from "../audit";
import { getProjectAccess, hasCapability } from "../access";
import { getUserId, requireUser } from "../auth/requireUser";

const CreateFolderSchema = z.object({
  name: z.string().trim().min(1).max(120),
  parentId: z.string().trim().min(1).optional().nullable()
});

const UpdateFolderSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

async function markFolderDeleted(folderId: string) {
  const children = await prisma.projectFolder.findMany({
    where: { parentId: folderId, deletedAt: null },
    select: { id: true }
  });

  for (const child of children) {
    await markFolderDeleted(child.id);
  }

  await prisma.media.updateMany({
    where: { folderId, deletedAt: null },
    data: { deletedAt: new Date() }
  });

  await prisma.projectFolder.update({
    where: { id: folderId },
    data: { deletedAt: new Date() }
  });
}

export async function folderRoutes(app: FastifyInstance) {
  app.post("/projects/:projectId/folders", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const input = CreateFolderSchema.parse(req.body);

    const access = await getProjectAccess({ userId, projectId });
    if (!access) return reply.code(404).send({ error: "not_found" });
    if (!hasCapability(access, "project:edit_assets")) return reply.code(403).send({ error: "forbidden" });

    if (input.parentId) {
      const parent = await prisma.projectFolder.findFirst({
        where: { id: input.parentId, projectId, deletedAt: null },
        select: { id: true }
      });
      if (!parent) return reply.code(404).send({ error: "parent_not_found" });
    }

    const folder = await prisma.projectFolder.create({
      data: {
        projectId,
        parentId: input.parentId ?? null,
        name: input.name
      },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        name: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "folder.create",
      entityType: "ProjectFolder",
      entityId: folder.id,
      meta: { projectId, parentId: folder.parentId }
    });

    return reply.code(201).send({ folder });
  });

  app.patch("/folders/:folderId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const folderId = (req.params as any).folderId as string;
    const input = UpdateFolderSchema.parse(req.body);

    const folder = await prisma.projectFolder.findFirst({
      where: { id: folderId, deletedAt: null },
      select: { id: true, projectId: true }
    });
    if (!folder) return reply.code(404).send({ error: "not_found" });
    const access = await getProjectAccess({ userId, projectId: folder.projectId });
    if (!access) return reply.code(404).send({ error: "not_found" });
    if (!hasCapability(access, "project:edit_assets")) return reply.code(403).send({ error: "forbidden" });

    const updated = await prisma.projectFolder.update({
      where: { id: folderId },
      data: { name: input.name },
      select: {
        id: true,
        projectId: true,
        parentId: true,
        name: true,
        createdAt: true,
        updatedAt: true
      }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "folder.rename",
      entityType: "ProjectFolder",
      entityId: updated.id,
      meta: { name: updated.name }
    });

    return reply.send({ folder: updated });
  });

  app.delete("/folders/:folderId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const folderId = (req.params as any).folderId as string;

    const folder = await prisma.projectFolder.findFirst({
      where: { id: folderId, deletedAt: null },
      select: { id: true, name: true, projectId: true }
    });
    if (!folder) return reply.code(404).send({ error: "not_found" });
    const access = await getProjectAccess({ userId, projectId: folder.projectId });
    if (!access) return reply.code(404).send({ error: "not_found" });
    if (!hasCapability(access, "project:edit_assets")) return reply.code(403).send({ error: "forbidden" });

    await markFolderDeleted(folderId);

    await auditLog({
      req,
      actorUserId: userId,
      action: "folder.delete",
      entityType: "ProjectFolder",
      entityId: folder.id,
      meta: { name: folder.name }
    });

    return reply.send({ ok: true });
  });
}
