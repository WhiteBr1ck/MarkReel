import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password";
import { getCurrentUser, requireUser } from "../auth/requireUser";
import { clearAuthCookies, setAuthCookies } from "../auth/tokens";
import { auditLog } from "../audit";
import { getStore } from "../store";
import { env } from "../env";
import { presignGetObject, presignPutObject } from "../s3";
import type { StoreUser } from "../store/types";

const UpdateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable(),
  avatarObjectKey: z.string().trim().min(1).max(260).nullable(),
  avatarContentType: z.string().trim().min(1).max(120).nullable(),
  avatarPreset: z.string().trim().min(1).max(80).nullable()
});

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(200),
  newPassword: z.string().min(8).max(200)
});

const DeleteAccountSchema = z.object({
  currentPassword: z.string().min(8).max(200)
});

const PresignAvatarSchema = z.object({
  filename: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120)
});

function toApiUser(user: StoreUser, avatarUrl?: string | null) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarObjectKey: user.avatarObjectKey,
    avatarContentType: user.avatarContentType,
    avatarPreset: user.avatarPreset,
    avatarUrl: avatarUrl ?? null,
    globalRole: user.globalRole,
    createdAt: user.createdAt
  };
}

async function buildAvatarUrl(user: Pick<StoreUser, "avatarObjectKey">) {
  if (!user.avatarObjectKey) return null;
  return presignGetObject({
    bucket: env.S3_BUCKET_ATTACHMENTS,
    objectKey: user.avatarObjectKey,
    expiresInSeconds: 900
  });
}

export async function userRoutes(app: FastifyInstance) {
  app.put("/users/me/profile", { preHandler: requireUser }, async (req, reply) => {
    const currentUser = getCurrentUser(req);
    const input = UpdateProfileSchema.parse(req.body);
    const store = getStore();
    const user = await store.userUpdateProfile({
      userId: currentUser.id,
      displayName: input.displayName,
      avatarObjectKey: input.avatarObjectKey,
      avatarContentType: input.avatarContentType,
      avatarPreset: input.avatarPreset
    });
    if (!user) return reply.code(404).send({ error: "not_found" });

    await auditLog({
      req,
      actorUserId: currentUser.id,
      action: "user.profile.update",
      entityType: "User",
      entityId: user.id,
      meta: {
        displayName: user.displayName,
        hasAvatar: Boolean(user.avatarObjectKey)
      }
    });

    const avatarUrl = await buildAvatarUrl(user);
    return reply.send({ user: toApiUser(user, avatarUrl) });
  });

  app.post("/users/me/avatar/presign", { preHandler: requireUser }, async (req, reply) => {
    const currentUser = getCurrentUser(req);
    const input = PresignAvatarSchema.parse(req.body);
    const ext = input.filename.includes(".") ? input.filename.split(".").pop()!.slice(0, 10) : "bin";
    const objectKey = `avatars/${currentUser.id}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const url = await presignPutObject({
      bucket: env.S3_BUCKET_ATTACHMENTS,
      objectKey,
      contentType: input.contentType
    });

    await auditLog({
      req,
      actorUserId: currentUser.id,
      action: "user.avatar.presign",
      entityType: "User",
      entityId: currentUser.id,
      meta: { objectKey, contentType: input.contentType }
    });

    return reply.send({
      upload: {
        method: "PUT",
        url,
        objectKey,
        bucket: env.S3_BUCKET_ATTACHMENTS,
        contentType: input.contentType
      }
    });
  });

  app.post("/users/me/change-password", { preHandler: requireUser }, async (req, reply) => {
    const currentUser = getCurrentUser(req);
    const input = ChangePasswordSchema.parse(req.body);
    const store = getStore();
    const user = await store.userFindById(currentUser.id);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const ok = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const passwordHash = await hashPassword(input.newPassword);
    const updated = await store.userChangePassword({
      userId: user.id,
      passwordHash,
      nextSessionVersion: user.sessionVersion + 1
    });
    if (!updated) return reply.code(404).send({ error: "not_found" });

    await setAuthCookies(reply, {
      userId: updated.id,
      sessionVersion: updated.sessionVersion
    });

    await auditLog({
      req,
      actorUserId: updated.id,
      action: "user.password.change",
      entityType: "User",
      entityId: updated.id
    });

    const avatarUrl = await buildAvatarUrl(updated);
    return reply.send({ user: toApiUser(updated, avatarUrl) });
  });

  app.post("/users/me/delete-account", { preHandler: requireUser }, async (req, reply) => {
    const currentUser = getCurrentUser(req);
    const input = DeleteAccountSchema.parse(req.body);
    const store = getStore();
    const user = await store.userFindById(currentUser.id);
    if (!user) return reply.code(401).send({ error: "unauthorized" });

    const ok = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const deleted = await store.userSoftDelete({ userId: user.id });
    if (!deleted) return reply.code(404).send({ error: "not_found" });

    clearAuthCookies(reply);

    await auditLog({
      req,
      actorUserId: deleted.id,
      action: "user.account.delete",
      entityType: "User",
      entityId: deleted.id,
      meta: { username: deleted.username }
    });

    return reply.send({ ok: true });
  });
}
