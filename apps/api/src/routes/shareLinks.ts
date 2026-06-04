import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { getUserId, requireUser } from "../auth/requireUser";
import { auditLog } from "../audit";
import { getProjectAccess, hasCapability } from "../access";
import { hashPassword, verifyPassword } from "../auth/password";
import { newShareToken, sha256Hex } from "../share";

const SharePermissionSchema = z.enum(["view", "comment", "annotate"]);
const ShareAudienceSchema = z.enum(["anyone", "authenticated"]);

const CreateShareSchema = z.object({
  label: z.string().trim().max(120).optional().nullable(),
  permissions: z.array(SharePermissionSchema).min(1),
  audience: ShareAudienceSchema.default("anyone"),
  password: z.string().min(1).max(120).optional().nullable(),
  maxUses: z.number().int().positive().max(100000).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable()
});

const UpdateShareSchema = z.object({
  label: z.string().trim().max(120).optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
  revoked: z.boolean().optional()
});

const ShareAccessSchema = z.object({
  password: z.string().optional()
});

type SerializedPermission = z.infer<typeof SharePermissionSchema>;

function serializeShareLinkPermissions(permissions: Array<{ permission: SerializedPermission }>) {
  return permissions.map(({ permission }) => permission);
}

function shareUrl(token: string) {
  return `/share/${token}`;
}

function serializeShareLink(link: any) {
  return {
    id: link.id,
    label: link.label,
    audience: link.audience,
    projectId: link.projectId,
    mediaId: link.mediaId,
    permissions: serializeShareLinkPermissions(link.permissions),
    hasPassword: !!link.passwordHash,
    maxUses: link.maxUses,
    useCount: link.useCount,
    lastUsedAt: link.lastUsedAt,
    expiresAt: link.expiresAt,
    revokedAt: link.revokedAt,
    createdAt: link.createdAt
  };
}

async function requireShareManagement(userId: string, projectId: string, reply: any) {
  const access = await getProjectAccess({ userId, projectId });
  if (!access) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  if (!hasCapability(access, "project:manage_share_links")) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return access;
}

export async function shareLinkRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/share-links", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const access = await requireShareManagement(userId, projectId, reply);
    if (!access) return;

    const links = await prisma.shareLink.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        audience: true,
        projectId: true,
        mediaId: true,
        passwordHash: true,
        maxUses: true,
        useCount: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        permissions: { select: { permission: true } }
      }
    });

    return { shareLinks: links.map(serializeShareLink) };
  });

  app.post("/projects/:projectId/share-links", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const input = CreateShareSchema.parse(req.body);
    const access = await requireShareManagement(userId, projectId, reply);
    if (!access) return;

    const token = newShareToken();
    const tokenHash = sha256Hex(token);
    const passwordHash = input.password ? await hashPassword(input.password) : null;

    const link = await prisma.shareLink.create({
      data: {
        tokenHash,
        projectId,
        createdById: userId,
        label: input.label || null,
        audience: input.audience,
        passwordHash,
        maxUses: input.maxUses ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        permissions: { create: input.permissions.map((permission) => ({ permission })) }
      },
      select: {
        id: true,
        label: true,
        audience: true,
        projectId: true,
        mediaId: true,
        passwordHash: true,
        maxUses: true,
        useCount: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        permissions: { select: { permission: true } }
      }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "share_link.create",
      entityType: "ShareLink",
      entityId: link.id,
      meta: { projectId, permissions: input.permissions, audience: input.audience, hasPassword: !!passwordHash }
    });

    return reply.code(201).send({
      shareLink: {
        ...serializeShareLink(link),
        token,
        url: shareUrl(token)
      }
    });
  });

  app.patch("/projects/:projectId/share-links/:shareLinkId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const shareLinkId = (req.params as any).shareLinkId as string;
    const input = UpdateShareSchema.parse(req.body);
    const access = await requireShareManagement(userId, projectId, reply);
    if (!access) return;

    const existing = await prisma.shareLink.findFirst({ where: { id: shareLinkId, projectId }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const link = await prisma.shareLink.update({
      where: { id: shareLinkId },
      data: {
        ...(input.label !== undefined ? { label: input.label || null } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
        ...(input.revoked !== undefined ? { revokedAt: input.revoked ? new Date() : null } : {})
      },
      select: {
        id: true,
        label: true,
        audience: true,
        projectId: true,
        mediaId: true,
        passwordHash: true,
        maxUses: true,
        useCount: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdAt: true,
        permissions: { select: { permission: true } }
      }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: input.revoked ? "share_link.revoke" : "share_link.update",
      entityType: "ShareLink",
      entityId: shareLinkId,
      meta: { projectId }
    });

    return { shareLink: serializeShareLink(link) };
  });

  app.delete("/projects/:projectId/share-links/:shareLinkId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const shareLinkId = (req.params as any).shareLinkId as string;
    const access = await requireShareManagement(userId, projectId, reply);
    if (!access) return;

    const existing = await prisma.shareLink.findFirst({ where: { id: shareLinkId, projectId }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const link = await prisma.shareLink.update({
      where: { id: shareLinkId },
      data: { revokedAt: new Date() },
      select: { id: true }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "share_link.revoke",
      entityType: "ShareLink",
      entityId: link.id,
      meta: { projectId }
    });

    return { ok: true };
  });

  app.get("/share/:token", async (req, reply) => {
    const token = (req.params as any).token as string;
    const tokenHash = sha256Hex(token);
    const link = await prisma.shareLink.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        label: true,
        audience: true,
        permissions: { select: { permission: true } },
        projectId: true,
        mediaId: true,
        passwordHash: true,
        maxUses: true,
        useCount: true,
        expiresAt: true,
        revokedAt: true
      }
    });
    if (!link) return reply.code(404).send({ error: "not_found" });
    if (link.revokedAt) return reply.code(410).send({ error: "revoked" });
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return reply.code(410).send({ error: "expired" });
    if (link.maxUses && link.useCount >= link.maxUses) return reply.code(410).send({ error: "max_uses_reached" });

    return reply.send({
      share: {
        id: link.id,
        label: link.label,
        audience: link.audience,
        projectId: link.projectId,
        mediaId: link.mediaId,
        permissions: serializeShareLinkPermissions(link.permissions),
        hasPassword: !!link.passwordHash,
        expiresAt: link.expiresAt
      }
    });
  });

  app.post("/share/:token/access", async (req, reply) => {
    const token = (req.params as any).token as string;
    const input = ShareAccessSchema.parse(req.body ?? {});
    const tokenHash = sha256Hex(token);
    const link = await prisma.shareLink.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        label: true,
        audience: true,
        permissions: { select: { permission: true } },
        projectId: true,
        mediaId: true,
        passwordHash: true,
        maxUses: true,
        useCount: true,
        expiresAt: true,
        revokedAt: true
      }
    });
    if (!link) return reply.code(404).send({ error: "not_found" });
    if (link.revokedAt) return reply.code(410).send({ error: "revoked" });
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return reply.code(410).send({ error: "expired" });
    if (link.maxUses && link.useCount >= link.maxUses) return reply.code(410).send({ error: "max_uses_reached" });
    if (link.passwordHash) {
      const ok = input.password ? await verifyPassword(input.password, link.passwordHash) : false;
      if (!ok) return reply.code(401).send({ error: "invalid_share_password" });
    }

    await prisma.shareLink.update({
      where: { id: link.id },
      data: { useCount: { increment: 1 }, lastUsedAt: new Date() }
    });

    return reply.send({
      share: {
        id: link.id,
        label: link.label,
        audience: link.audience,
        projectId: link.projectId,
        mediaId: link.mediaId,
        permissions: serializeShareLinkPermissions(link.permissions),
        expiresAt: link.expiresAt
      }
    });
  });
}
