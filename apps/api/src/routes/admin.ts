import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword } from "../auth/password";
import { getCurrentUser, requireAdmin } from "../auth/requireUser";
import { auditLog } from "../audit";
import { getStore } from "../store";
import type { StoreUser } from "../store/types";

const CreateAdminUserSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_\-.]+$/),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(80).optional()
});

const UpdateAdminUserProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(80).nullable()
});

const ResetAdminUserPasswordSchema = z.object({
  newPassword: z.string().min(8).max(200)
});

type AdminUserShape = Pick<
  StoreUser,
  "id" | "username" | "displayName" | "avatarObjectKey" | "avatarContentType" | "globalRole" | "createdAt" | "updatedAt"
>;

function toAdminUser(user: AdminUserShape) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarObjectKey: user.avatarObjectKey,
    avatarContentType: user.avatarContentType,
    globalRole: user.globalRole,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/users", { preHandler: requireAdmin }, async () => {
    const users = await getStore().userList();
    return { users: users.map((user) => toAdminUser(user)) };
  });

  app.post("/admin/users", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const input = CreateAdminUserSchema.parse(req.body);
    const passwordHash = await hashPassword(input.password);
    try {
      const user = await getStore().userCreateByAdmin({
        username: input.username,
        passwordHash,
        displayName: input.displayName ?? null,
        globalRole: "user"
      });

      await auditLog({
        req,
        actorUserId: actor.id,
        action: "admin.user.create",
        entityType: "User",
        entityId: user.id,
        meta: { username: user.username }
      });

      return reply.code(201).send({ user: toAdminUser(user) });
    } catch (error) {
      if ((error as Error).message === "username_taken") {
        return reply.code(409).send({ error: "username_taken" });
      }
      throw error;
    }
  });

  app.patch("/admin/users/:userId/profile", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const userId = (req.params as { userId: string }).userId;
    const input = UpdateAdminUserProfileSchema.parse(req.body);
    const user = await getStore().adminUpdateUserProfile({
      userId,
      displayName: input.displayName
    });
    if (!user) return reply.code(404).send({ error: "not_found" });

    await auditLog({
      req,
      actorUserId: actor.id,
      action: "admin.user.update",
      entityType: "User",
      entityId: user.id,
      meta: { username: user.username, displayName: user.displayName }
    });

    return reply.send({ user: toAdminUser(user) });
  });

  app.post("/admin/users/:userId/reset-password", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const userId = (req.params as { userId: string }).userId;
    if (userId === actor.id) {
      return reply.code(400).send({ error: "use_user_settings" });
    }

    const input = ResetAdminUserPasswordSchema.parse(req.body);
    const existing = await getStore().userFindById(userId);
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const passwordHash = await hashPassword(input.newPassword);
    const user = await getStore().adminResetUserPassword({
      userId,
      passwordHash,
      nextSessionVersion: existing.sessionVersion + 1
    });
    if (!user) return reply.code(404).send({ error: "not_found" });

    await auditLog({
      req,
      actorUserId: actor.id,
      action: "admin.user.reset_password",
      entityType: "User",
      entityId: user.id,
      meta: { username: user.username }
    });

    return reply.send({ ok: true });
  });

  app.delete("/admin/users/:userId", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const userId = (req.params as { userId: string }).userId;
    if (userId === actor.id) {
      return reply.code(400).send({ error: "cannot_delete_self" });
    }

    const user = await getStore().userSoftDelete({ userId });
    if (!user) return reply.code(404).send({ error: "not_found" });

    await auditLog({
      req,
      actorUserId: actor.id,
      action: "admin.user.delete",
      entityType: "User",
      entityId: user.id,
      meta: { username: user.username }
    });

    return reply.send({ ok: true });
  });
}
