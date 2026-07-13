import type { FastifyInstance } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import { getStore } from "../store";
import { getUserId, requireUser } from "../auth/requireUser";
import { auditLog } from "../audit";
import { getMediaAccess, getProjectAccess, hasCapability, hasMediaCapability } from "../access";
import { hashPassword, verifyPassword } from "../auth/password";
import { ACCESS_COOKIE, authInstanceId, parseAuthTokenPayload } from "../auth/tokens";
import { newShareToken, sha256Hex } from "../share";
import { env } from "../env";
import { sendObjectResponse } from "../objectResponse";
import { putRequestBodyObject } from "../uploadProxy";
import { serializeMediaFiles } from "../mediaSerialization";
import { ensureTechnicalMetadata, technicalMetadataSelect } from "../mediaTechnicalMetadata";

const SharePermissionSchema = z.enum(["view", "comment", "annotate"]);
const ShareAudienceSchema = z.enum(["anyone", "authenticated"]);

const CreateShareSchema = z.object({
  label: z.string().trim().max(120).optional().nullable(),
  permissions: z.array(SharePermissionSchema).min(1),
  audience: ShareAudienceSchema.default("anyone"),
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

const CreateShareAnnotationSchema = z.object({
  timestampMs: z.number().int().min(0),
  type: z.enum(["pin", "rect", "text"]),
  rect: RectSchema.optional(),
  body: z.string().max(5000).default(""),
  color: z.string().min(1).max(32).optional(),
  parentId: z.string().min(1).optional().nullable(),
  attachments: z.array(AttachmentSchema).default([])
});

const UpdateShareAnnotationSchema = z.object({
  timestampMs: z.number().int().min(0).optional(),
  body: z.string().max(5000).optional(),
  color: z.string().min(1).max(32).optional(),
  attachments: z.array(AttachmentSchema).optional()
});

const CompletionSchema = z.object({
  completed: z.boolean()
});

const ShareAttachmentPresignSchema = z.object({
  filename: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120)
});

const ShareAnnotationFilterSchema = z.object({
  status: z.enum(["all", "completed", "incomplete"]).optional().default("all")
});

const CreateMediaShareSchema = CreateShareSchema.extend({
  permissions: z.array(z.enum(["view", "annotate"])).min(1)
});

type SerializedPermission = z.infer<typeof SharePermissionSchema>;
const SHARE_GUEST_COOKIE = "mr_share_guest";

function serializeShareLinkPermissions(permissions: Array<{ permission: SerializedPermission }>) {
  return permissions.map(({ permission }) => permission);
}

function shareUrl(token: string) {
  return `/share/${token}`;
}

function shareFallbackUrl(linkId: string) {
  return `/share/${linkId}`;
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
    createdAt: link.createdAt,
    url: shareFallbackUrl(link.id)
  };
}

async function resolveShareIdentifier(identifier: string) {
  const byToken = await prisma.shareLink.findUnique({ where: { tokenHash: sha256Hex(identifier) }, select: { id: true } });
  if (byToken) return byToken.id;
  const byId = await prisma.shareLink.findUnique({ where: { id: identifier }, select: { id: true } });
  return byId?.id ?? null;
}

async function getOptionalUserId(req: any, reply: any) {
  try {
    const rawPayload = await req.jwtVerify({ cookie: { cookieName: ACCESS_COOKIE } });
    const payload = parseAuthTokenPayload(rawPayload);
    if (!payload || payload.si !== authInstanceId) return null;
    const user = await getStore().userFindById(payload.sub);
    if (!user || user.disabledAt || user.sessionVersion !== payload.sv) return null;
    return user.id;
  } catch {
    return null;
  }
}

async function getShareActorUserId(req: any, reply: any) {
  const existingUserId = await getOptionalUserId(req, reply);
  if (existingUserId) return existingUserId;

  const existingGuestId = req.cookies?.[SHARE_GUEST_COOKIE];
  if (existingGuestId) {
    const guest = await getStore().userFindById(existingGuestId);
    if (guest && !guest.disabledAt) return guest.id;
  }

  const suffix = newShareToken().slice(0, 12).toLowerCase();
  const username = `guest_${suffix}`;
  const passwordHash = await hashPassword(newShareToken());
  const guest = await getStore().userCreateOrRevive({ username, passwordHash, displayName: `访客 ${suffix.slice(0, 4)}`, globalRole: "user" });
  reply.setCookie(SHARE_GUEST_COOKIE, guest.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30
  });
  return guest.id;
}

function hasShareViewPermission(permissions: SerializedPermission[]) {
  return permissions.some((permission) => permission === "view" || permission === "annotate" || permission === "comment");
}

function shareMediaCapabilities(permissions: SerializedPermission[]) {
  const capabilities = ["media:view"];
  if (permissions.includes("annotate")) capabilities.push("media:annotate");
  return capabilities;
}

function getShareAnnotationWhere(mediaId: string, status: "all" | "completed" | "incomplete") {
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

function withShareAttachmentUrls<T extends Array<any>>(token: string, annotations: T): T {
  return annotations.map((annotation) => ({
    ...annotation,
    attachments: annotation.attachments.map((attachment: any) => ({
      ...attachment,
      previewUrl: `/api/share/${token}/attachments/${attachment.id}/file`
    })),
    replies: annotation.replies?.map((reply: any) => ({
      ...reply,
      attachments: reply.attachments.map((attachment: any) => ({
        ...attachment,
        previewUrl: `/api/share/${token}/attachments/${attachment.id}/file`
      }))
    }))
  })) as T;
}

const shareAnnotationReplySelect = {
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
  author: { select: { id: true, username: true, displayName: true, avatarPreset: true } },
  completedBy: { select: { id: true, username: true, displayName: true, avatarPreset: true } },
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

const shareAnnotationSelect: Prisma.AnnotationSelect = {
  ...shareAnnotationReplySelect,
  replies: {
    where: { deletedAt: null },
    orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }],
    select: shareAnnotationReplySelect
  }
};


async function getPreviewTargetForSharedMedia(mediaId: string) {
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
          id: true,
          sizeBytes: true,
          ...technicalMetadataSelect,
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

async function requireActiveMediaShare(token: string, reply: any) {
  const shareLinkId = await resolveShareIdentifier(token);
  const link = await prisma.shareLink.findUnique({
    where: { id: shareLinkId ?? "" },
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
      revokedAt: true,
      media: {
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
          deletedAt: true,
          project: { select: { organizationId: true } },
          creator: { select: { id: true, username: true, displayName: true } },
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
              formatName: true,
              videoCodec: true,
              videoProfile: true,
              videoPixelFormat: true,
              videoFrameRate: true,
              videoBitrateKbps: true,
              audioCodec: true,
              audioBitrateKbps: true,
              technicalMetadataProbedAt: true,
              createdAt: true
            },
            orderBy: { createdAt: "desc" }
          }
        }
      }
    }
  });

  const media = link?.media ?? null;
  if (!link || !link.mediaId || !media || media.deletedAt) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  if (link.revokedAt) {
    reply.code(410).send({ error: "revoked" });
    return null;
  }
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) {
    reply.code(410).send({ error: "expired" });
    return null;
  }
  if (link.maxUses && link.useCount >= link.maxUses) {
    reply.code(410).send({ error: "max_uses_reached" });
    return null;
  }
  if (link.passwordHash) {
    reply.code(401).send({ error: "invalid_share_password" });
    return null;
  }

  const permissions = serializeShareLinkPermissions(link.permissions);
  if (!hasShareViewPermission(permissions)) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }

  return { ...link, media, serializedPermissions: permissions };
}

function canShareAnnotate(permissions: SerializedPermission[]) {
  return permissions.includes("annotate");
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

async function requireMediaShareManagement(userId: string, mediaId: string, reply: any) {
  const result = await getMediaAccess({ userId, mediaId });
  if (!result) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  if (!hasMediaCapability(result.access, "media:manage")) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return result;
}

const shareLinkSelect = {
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
} as const;

export async function shareLinkRoutes(app: FastifyInstance) {
  app.get("/media/:mediaId/share-links", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const access = await requireMediaShareManagement(userId, mediaId, reply);
    if (!access) return;

    const links = await prisma.shareLink.findMany({
      where: { mediaId, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: shareLinkSelect
    });

    return { shareLinks: links.map(serializeShareLink) };
  });

  app.post("/media/:mediaId/share-links", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const input = CreateMediaShareSchema.parse(req.body);
    const access = await requireMediaShareManagement(userId, mediaId, reply);
    if (!access) return;

    const token = newShareToken();
    const tokenHash = sha256Hex(token);
    const link = await prisma.shareLink.create({
      data: {
        tokenHash,
        projectId: access.media.projectId,
        mediaId,
        createdById: userId,
        label: input.label || null,
        audience: input.audience,
        passwordHash: null,
        maxUses: input.maxUses ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        permissions: { create: input.permissions.map((permission) => ({ permission })) }
      },
      select: shareLinkSelect
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "media_share_link.create",
      entityType: "ShareLink",
      entityId: link.id,
      meta: { projectId: access.media.projectId, mediaId, permissions: input.permissions, audience: input.audience }
    });

    return reply.code(201).send({
      shareLink: {
        ...serializeShareLink(link),
        token,
        url: shareUrl(token)
      }
    });
  });

  app.patch("/media/:mediaId/share-links/:shareLinkId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const shareLinkId = (req.params as any).shareLinkId as string;
    const input = UpdateShareSchema.parse(req.body);
    const access = await requireMediaShareManagement(userId, mediaId, reply);
    if (!access) return;

    const existing = await prisma.shareLink.findFirst({ where: { id: shareLinkId, mediaId }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const link = await prisma.shareLink.update({
      where: { id: shareLinkId },
      data: {
        ...(input.label !== undefined ? { label: input.label || null } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
        ...(input.revoked !== undefined ? { revokedAt: input.revoked ? new Date() : null } : {})
      },
      select: shareLinkSelect
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: input.revoked ? "media_share_link.revoke" : "media_share_link.update",
      entityType: "ShareLink",
      entityId: shareLinkId,
      meta: { projectId: access.media.projectId, mediaId }
    });

    return { shareLink: serializeShareLink(link) };
  });

  app.delete("/media/:mediaId/share-links/:shareLinkId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const mediaId = (req.params as any).mediaId as string;
    const shareLinkId = (req.params as any).shareLinkId as string;
    const access = await requireMediaShareManagement(userId, mediaId, reply);
    if (!access) return;

    const existing = await prisma.shareLink.findFirst({ where: { id: shareLinkId, mediaId }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const link = await prisma.shareLink.update({
      where: { id: shareLinkId },
      data: { revokedAt: new Date() },
      select: { id: true }
    });

    await auditLog({ req, actorUserId: userId, action: "media_share_link.revoke", entityType: "ShareLink", entityId: link.id, meta: { projectId: access.media.projectId, mediaId } });

    return { ok: true };
  });

  app.get("/projects/:projectId/share-links", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const access = await requireShareManagement(userId, projectId, reply);
    if (!access) return;

    const links = await prisma.shareLink.findMany({
      where: { projectId, mediaId: null, revokedAt: null },
      orderBy: { createdAt: "desc" },
      select: shareLinkSelect
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
    const link = await prisma.shareLink.create({
      data: {
        tokenHash,
        projectId,
        createdById: userId,
        label: input.label || null,
        audience: input.audience,
        passwordHash: null,
        maxUses: input.maxUses ?? null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        permissions: { create: input.permissions.map((permission) => ({ permission })) }
      },
      select: shareLinkSelect
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "share_link.create",
      entityType: "ShareLink",
      entityId: link.id,
      meta: { projectId, permissions: input.permissions, audience: input.audience }
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

    const existing = await prisma.shareLink.findFirst({ where: { id: shareLinkId, projectId, mediaId: null }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const link = await prisma.shareLink.update({
      where: { id: shareLinkId },
      data: {
        ...(input.label !== undefined ? { label: input.label || null } : {}),
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null } : {}),
        ...(input.revoked !== undefined ? { revokedAt: input.revoked ? new Date() : null } : {})
      },
      select: shareLinkSelect
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

    const existing = await prisma.shareLink.findFirst({ where: { id: shareLinkId, projectId, mediaId: null }, select: { id: true } });
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

  app.get("/share/:token/media", async (req, reply) => {
    const token = (req.params as any).token as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link) return;

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
        permissions: link.serializedPermissions,
        expiresAt: link.expiresAt
      },
      media: {
        id: link.media.id,
        projectId: link.media.projectId,
        folderId: link.media.folderId,
        title: link.media.title,
        status: link.media.status,
        reviewStatus: link.media.reviewStatus,
        versionIndex: link.media.versionIndex,
        seriesId: link.media.seriesId,
        createdAt: link.media.createdAt,
        updatedAt: link.media.updatedAt,
        capabilities: shareMediaCapabilities(link.serializedPermissions),
        projectCapabilities: [],
        organizationId: link.media.project.organizationId,
        creator: link.media.creator,
        files: serializeMediaFiles(link.media.files),
        myRating: null,
        averageRating: null,
        ratingCount: 0,
        previewUrl: `/api/share/${token}/media/file`
      }
    });
  });

  app.get("/share/:token/media/file", async (req, reply) => {
    const token = (req.params as any).token as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;

    const result = await getPreviewTargetForSharedMedia(link.mediaId);
    if (!result) return reply.code(404).send({ error: "preview_not_ready" });
    if ("failed" in result) return reply.code(409).send({ error: "processing_failed" });
    return sendObjectResponse({ reply, target: result.target, kind: "video", range: typeof req.headers.range === "string" ? req.headers.range : undefined, notFoundError: "preview_not_ready" });
  });

  app.get("/share/:token/media/technical-metadata", async (req, reply) => {
    const token = (req.params as any).token as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;

    const result = await getPreviewTargetForSharedMedia(link.mediaId);
    if (!result) return reply.code(404).send({ error: "preview_not_ready" });
    if ("failed" in result) return reply.code(409).send({ error: "processing_failed" });
    const file = result.media.files[0];
    if (!file) return reply.code(404).send({ error: "preview_not_ready" });

    try {
      const metadata = await ensureTechnicalMetadata(file, result.target);
      return reply.send({ metadata });
    } catch {
      return reply.code(503).send({ error: "technical_metadata_unavailable" });
    }
  });

  app.get("/share/:token/annotations", async (req, reply) => {
    const token = (req.params as any).token as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;

    const query = ShareAnnotationFilterSchema.parse(req.query ?? {});
    const annotations = await prisma.annotation.findMany({
      where: getShareAnnotationWhere(link.mediaId, query.status),
      orderBy: [{ timestampMs: "asc" }, { createdAt: "asc" }],
      select: shareAnnotationSelect
    });

    return reply.send({ annotations: withShareAttachmentUrls(token, annotations) });
  });

  app.post("/share/:token/annotations", async (req, reply) => {
    const token = (req.params as any).token as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;
    if (!canShareAnnotate(link.serializedPermissions)) return reply.code(403).send({ error: "forbidden" });

    const input = CreateShareAnnotationSchema.parse(req.body);
    const actorUserId = await getShareActorUserId(req, reply);
    if (input.parentId) {
      const parent = await prisma.annotation.findFirst({ where: { id: input.parentId, mediaId: link.mediaId, deletedAt: null }, select: { id: true } });
      if (!parent) return reply.code(404).send({ error: "parent_not_found" });
    }

    const ann = await prisma.annotation.create({
      data: {
        projectId: link.media.projectId,
        mediaId: link.mediaId,
        authorId: actorUserId,
        parentId: input.parentId ?? null,
        timestampMs: input.timestampMs,
        type: input.type,
        rect: input.rect ?? undefined,
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

    await auditLog({ req, actorUserId, action: ann.parentId ? "share.annotation.reply" : "share.annotation.create", entityType: "Annotation", entityId: ann.id, meta: { mediaId: link.mediaId, shareLinkId: link.id } });
    return reply.code(201).send({ id: ann.id });
  });

  app.patch("/share/:token/annotations/:annotationId", async (req, reply) => {
    const token = (req.params as any).token as string;
    const annotationId = (req.params as any).annotationId as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;
    if (!canShareAnnotate(link.serializedPermissions)) return reply.code(403).send({ error: "forbidden" });

    const actorUserId = await getShareActorUserId(req, reply);
    const existing = await prisma.annotation.findFirst({ where: { id: annotationId, mediaId: link.mediaId, deletedAt: null }, select: { id: true, authorId: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.authorId !== actorUserId) return reply.code(403).send({ error: "forbidden" });

    const input = UpdateShareAnnotationSchema.parse(req.body);
    await prisma.annotation.update({
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

    await auditLog({ req, actorUserId, action: "share.annotation.update", entityType: "Annotation", entityId: annotationId, meta: { mediaId: link.mediaId, shareLinkId: link.id } });
    return reply.send({ id: annotationId });
  });

  app.patch("/share/:token/annotations/:annotationId/completion", async (req, reply) => {
    const token = (req.params as any).token as string;
    const annotationId = (req.params as any).annotationId as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;
    if (!canShareAnnotate(link.serializedPermissions)) return reply.code(403).send({ error: "forbidden" });

    const actorUserId = await getShareActorUserId(req, reply);
    const existing = await prisma.annotation.findFirst({ where: { id: annotationId, mediaId: link.mediaId, deletedAt: null }, select: { id: true, authorId: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const input = CompletionSchema.parse(req.body);
    const annotation = await prisma.annotation.update({
      where: { id: annotationId },
      data: input.completed ? { completedAt: new Date(), completedById: actorUserId } : { completedAt: null, completedById: null },
      select: { id: true, completedAt: true }
    });

    await auditLog({ req, actorUserId, action: input.completed ? "share.annotation.complete" : "share.annotation.reopen", entityType: "Annotation", entityId: annotationId, meta: { mediaId: link.mediaId, shareLinkId: link.id } });
    return reply.send({ id: annotation.id, completedAt: annotation.completedAt });
  });

  app.delete("/share/:token/annotations/:annotationId", async (req, reply) => {
    const token = (req.params as any).token as string;
    const annotationId = (req.params as any).annotationId as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;
    if (!canShareAnnotate(link.serializedPermissions)) return reply.code(403).send({ error: "forbidden" });

    const actorUserId = await getShareActorUserId(req, reply);
    const existing = await prisma.annotation.findFirst({ where: { id: annotationId, mediaId: link.mediaId, deletedAt: null }, select: { id: true, authorId: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.authorId !== actorUserId) return reply.code(403).send({ error: "forbidden" });

    await prisma.$transaction(async (tx) => {
      await tx.annotation.updateMany({ where: { parentId: annotationId, deletedAt: null }, data: { deletedAt: new Date() } });
      await tx.annotation.update({ where: { id: annotationId }, data: { deletedAt: new Date() } });
    });
    await auditLog({ req, actorUserId, action: "share.annotation.delete", entityType: "Annotation", entityId: annotationId, meta: { mediaId: link.mediaId, shareLinkId: link.id } });
    return reply.send({ ok: true });
  });

  app.post("/share/:token/attachments/presign", async (req, reply) => {
    const token = (req.params as any).token as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;
    if (!canShareAnnotate(link.serializedPermissions)) return reply.code(403).send({ error: "forbidden" });

    const input = ShareAttachmentPresignSchema.parse(req.body);
    const ext = input.filename.includes(".") ? input.filename.split(".").pop()!.slice(0, 10) : "bin";
    const objectKey = input.filename.startsWith("markup-") ? `attachments/markup/${newShareToken().slice(0, 18)}.${ext}` : `attachments/share/${newShareToken().slice(0, 18)}.${ext}`;
    const url = `/api/share/${token}/attachments/upload/file?objectKey=${encodeURIComponent(objectKey)}`;
    return reply.send({ upload: { method: "PUT", url, objectKey, bucket: env.S3_BUCKET_ATTACHMENTS } });
  });

  app.put("/share/:token/attachments/upload/file", async (req, reply) => {
    const token = (req.params as any).token as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;
    if (!canShareAnnotate(link.serializedPermissions)) return reply.code(403).send({ error: "forbidden" });

    const objectKey = String((req.query as any).objectKey ?? "");
    if (!objectKey.startsWith("attachments/")) return reply.code(400).send({ error: "invalid_object_key" });
    await putRequestBodyObject({ req, bucket: env.S3_BUCKET_ATTACHMENTS, objectKey, contentType: req.headers["content-type"] ?? undefined });
    return reply.send({ ok: true, objectKey });
  });

  app.get("/share/:token/attachments/:attachmentId/file", async (req, reply) => {
    const token = (req.params as any).token as string;
    const attachmentId = (req.params as any).attachmentId as string;
    const link = await requireActiveMediaShare(token, reply);
    if (!link || !link.mediaId) return;

    const attachment = await prisma.attachment.findFirst({
      where: {
        id: attachmentId,
        annotation: { mediaId: link.mediaId, deletedAt: null }
      },
      select: { objectKey: true }
    });
    if (!attachment) return reply.code(404).send({ error: "not_found" });

    return sendObjectResponse({ reply, target: { bucket: env.S3_BUCKET_ATTACHMENTS, objectKey: attachment.objectKey }, kind: "attachment", range: typeof req.headers.range === "string" ? req.headers.range : undefined });
  });
}
