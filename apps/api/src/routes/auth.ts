import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password";
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  parseAuthTokenPayload,
  serverInstanceId,
  setAuthCookies
} from "../auth/tokens";
import { env } from "../env";
import { getStore } from "../store";
import { getCurrentUser, requireUser } from "../auth/requireUser";
import { presignGetObject } from "../s3";
import type { StoreUser } from "../store/types";

const RegisterSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_\-.]+$/),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(80).optional()
});

const LoginSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(200)
});

async function buildAvatarUrl(user: Pick<StoreUser, "avatarObjectKey">) {
  if (!user.avatarObjectKey) return null;
  return presignGetObject({
    bucket: env.S3_BUCKET_ATTACHMENTS,
    objectKey: user.avatarObjectKey,
    expiresInSeconds: 900
  });
}

async function toApiUser(user: StoreUser) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarObjectKey: user.avatarObjectKey,
    avatarContentType: user.avatarContentType,
    avatarUrl: await buildAvatarUrl(user),
    globalRole: user.globalRole,
    createdAt: user.createdAt
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (req, reply) => {
    const input = RegisterSchema.parse(req.body);

    const store = getStore();

    const existing = await store.userFindByUsername(input.username);
    if (existing) return reply.code(409).send({ error: "username_taken" });

    const passwordHash = await hashPassword(input.password);
    const user = await store.userCreateOrRevive({
      username: input.username,
      passwordHash,
      displayName: input.displayName ?? null,
      globalRole: "user"
    });

    await setAuthCookies(reply, { userId: user.id, sessionVersion: user.sessionVersion });
    return reply.send({ user: await toApiUser(user) });
  });

  app.post("/auth/login", async (req, reply) => {
    const input = LoginSchema.parse(req.body);
    const store = getStore();
    const user = await store.userFindByUsername(input.username);
    if (!user) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const ok = await verifyPassword(input.password, user.passwordHash);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    await setAuthCookies(reply, { userId: user.id, sessionVersion: user.sessionVersion });
    return reply.send({ user: await toApiUser(user) });
  });

  app.post("/auth/refresh", async (req, reply) => {
    try {
      const rawPayload = await (req as any).jwtVerify({
        secret: env.JWT_REFRESH_SECRET,
        cookie: { cookieName: REFRESH_COOKIE }
      });
      const payload = parseAuthTokenPayload(rawPayload);
      if (!payload || payload.si !== serverInstanceId) {
        clearAuthCookies(reply);
        return reply.code(401).send({ error: "unauthorized" });
      }

      const user = await getStore().userFindById(payload.sub);
      if (!user || user.sessionVersion !== payload.sv) {
        clearAuthCookies(reply);
        return reply.code(401).send({ error: "unauthorized" });
      }

      await setAuthCookies(reply, { userId: user.id, sessionVersion: user.sessionVersion });
      return reply.send({ ok: true });
    } catch {
      clearAuthCookies(reply);
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.post("/auth/logout", async (_req, reply) => {
    clearAuthCookies(reply);
    return reply.send({ ok: true });
  });

  app.get("/me", { preHandler: requireUser }, async (req) => {
    const user = await getStore().userFindById(getCurrentUser(req).id);
    return { user: user ? await toApiUser(user) : null };
  });
}
