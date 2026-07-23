import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auditLog } from "../audit";
import { getUserId, requireUser } from "../auth/requireUser";
import { getStore } from "../store";
import { prisma } from "../db";
import { getProjectAccess, hasCapability } from "../access";
import { serializeSizeBytes } from "../mediaSerialization";

const CreateProjectSchema = z.object({
  name: z.string().min(1).max(120),
  organizationId: z.string().optional().nullable(),
  organizationPermission: z.enum(["manage", "upload", "view"]).optional().nullable()
});

const UpdateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const WorkspaceQuerySchema = z.object({
  folderId: z.string().optional()
});

function hasBrokenText(value: string) {
  return value.includes("�");
}

function dedupeMediaByFolderAndTitle<T extends { id: string; folderId: string | null; title: string; createdAt: Date }>(items: T[]) {
  const latestByKey = new Map<string, T>();

  for (const item of items) {
    const key = `${item.folderId ?? "root"}::${item.title}`;
    const existing = latestByKey.get(key);
    if (!existing || item.createdAt > existing.createdAt) {
      latestByKey.set(key, item);
    }
  }

  return Array.from(latestByKey.values());
}

function buildFolderTree(
  folders: Array<{ id: string; parentId: string | null; name: string }>,
  projectId: string
) {
  const rootId = `root-${projectId}`;
  const childrenByParent = new Map<string | null, Array<{ id: string; parentId: string | null; name: string }>>();
  type FolderTreeNode = { id: string; name: string; children: FolderTreeNode[] };

  for (const folder of folders) {
    const key = folder.parentId ?? null;
    const list = childrenByParent.get(key) ?? [];
    list.push(folder);
    childrenByParent.set(key, list);
  }

  const build = (parentId: string | null): FolderTreeNode[] =>
    (childrenByParent.get(parentId) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .map((folder): FolderTreeNode => ({
        id: folder.id,
        name: folder.name,
        children: build(folder.id)
      }));

  return {
    id: rootId,
    name: "",
    children: build(null)
  };
}

export async function projectRoutes(app: FastifyInstance) {
  app.get("/projects", { preHandler: requireUser }, async (req) => {
    const userId = getUserId(req);
    const store = getStore();
    const projects = await store.projectListForUser(userId);
    return { projects };
  });

  app.post("/projects", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const input = CreateProjectSchema.parse(req.body);

    const store = getStore();
    if (input.organizationPermission && store.kind === "inmemory") {
      return reply.code(400).send({ error: "permissions_require_persistent_store" });
    }
    const project = await store.projectCreate({
      userId,
      name: input.name,
      organizationId: input.organizationId ?? null,
      organizationPermission: input.organizationPermission ?? null
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "project.create",
      entityType: "Project",
      entityId: project.id,
      meta: { name: project.name, organizationPermission: input.organizationPermission ?? null }
    });

    return reply.code(201).send({ project });
  });

  app.get("/projects/:projectId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;

    const store = getStore();
    const project = await store.projectGetForUser({ userId, projectId });

    if (!project) return reply.code(404).send({ error: "not_found" });
    return { project };
  });

  app.patch("/projects/:projectId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const input = UpdateProjectSchema.parse(req.body);

    const store = getStore();
    if (store.kind !== "inmemory") {
      const access = await getProjectAccess({ userId, projectId });
      if (!access) return reply.code(404).send({ error: "not_found" });
      if (!hasCapability(access, "project:edit_assets")) return reply.code(403).send({ error: "forbidden" });
    }

    const project = await store.projectRenameForUser({ userId, projectId, name: input.name });
    if (!project) return reply.code(404).send({ error: "not_found" });

    await auditLog({
      req,
      actorUserId: userId,
      action: "project.rename",
      entityType: "Project",
      entityId: project.id,
      meta: { name: project.name }
    });

    return { project };
  });

  app.delete("/projects/:projectId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;

    const store = getStore();
    if (store.kind !== "inmemory") {
      const access = await getProjectAccess({ userId, projectId });
      if (!access) return reply.code(404).send({ error: "not_found" });
      if (!hasCapability(access, "project:delete")) return reply.code(403).send({ error: "forbidden" });
    }

    const project = await store.projectDeleteForUser({ userId, projectId });
    if (!project) return reply.code(404).send({ error: "not_found" });

    await auditLog({
      req,
      actorUserId: userId,
      action: "project.delete",
      entityType: "Project",
      entityId: project.id,
      meta: { name: project.name }
    });

    return reply.send({ ok: true });
  });

  app.get("/projects/:projectId/workspace", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const query = WorkspaceQuerySchema.parse(req.query ?? {});

    const store = getStore();
    const project = await store.projectGetForUser({ userId, projectId });
    if (!project) return reply.code(404).send({ error: "not_found" });

    if (getStore().kind === "inmemory") {
      const rootId = `root-${projectId}`;
      return {
        project,
        activeFolderId: query.folderId ?? rootId,
        breadcrumbs: [],
        folderTree: { id: rootId, name: "", children: [] },
        items: []
      };
    }

    const folders = (await prisma.projectFolder.findMany({
      where: { projectId, deletedAt: null },
      select: { id: true, parentId: true, name: true, updatedAt: true },
      orderBy: [{ name: "asc" }]
    })).filter((folder) => !hasBrokenText(folder.name));

    const rootId = `root-${projectId}`;
    const activeFolderId = query.folderId ?? rootId;
    const parentId = activeFolderId === rootId ? null : activeFolderId;

    if (parentId) {
      const exists = folders.some((folder) => folder.id === parentId);
      if (!exists) return reply.code(404).send({ error: "folder_not_found" });
    }

    const media = dedupeMediaByFolderAndTitle(
      await prisma.media.findMany({
        where: { projectId, folderId: parentId, deletedAt: null },
        select: {
          id: true,
          folderId: true,
          title: true,
          updatedAt: true,
          createdAt: true,
          status: true,
          files: {
            select: {
              durationMs: true,
              width: true,
              height: true,
              sizeBytes: true,
              bitrateKbps: true,
              frameCount: true,
              originalObjectKey: true,
              thumbnailObjectKey: true
            },
            orderBy: { createdAt: "desc" },
            take: 1
          }
        },
        orderBy: [{ updatedAt: "desc" }]
      })
    );

    const items = [
      ...folders
        .filter((folder) => folder.parentId === parentId)
        .map((folder) => ({
          id: folder.id,
          kind: "folder" as const,
          name: folder.name,
          updatedAt: folder.updatedAt.getTime()
        })),
      ...media.map((item) => ({
        id: item.id,
        kind: "video" as const,
        name: item.title,
        updatedAt: item.updatedAt.getTime(),
        durationSeconds: item.files[0]?.durationMs ? Math.round(item.files[0].durationMs / 1000) : undefined,
        sizeBytes: serializeSizeBytes(item.files[0]?.sizeBytes),
        width: item.files[0]?.width ?? undefined,
        height: item.files[0]?.height ?? undefined,
        frameCount: item.files[0]?.frameCount ?? undefined,
        bitrateKbps: item.files[0]?.bitrateKbps ?? undefined,
        thumbnailUrl: item.files[0]?.thumbnailObjectKey ? `/api/media/${item.id}/thumbnail/file` : null,
        status: item.status
      }))
    ];

    const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
    const breadcrumbs: Array<{ id: string; name: string }> = [];
    if (parentId) {
      const chain: Array<{ id: string; name: string }> = [];
      let current = folderMap.get(parentId) ?? null;
      while (current) {
        chain.unshift({ id: current.id, name: current.name });
        current = current.parentId ? folderMap.get(current.parentId) ?? null : null;
      }
      breadcrumbs.push(...chain);
    }

    return {
      project,
      activeFolderId,
      breadcrumbs,
      folderTree: buildFolderTree(folders, projectId),
      items
    };
  });
}
