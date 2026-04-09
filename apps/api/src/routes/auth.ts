import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../auth/password";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from "../auth/tokens";
import { env } from "../env";
import { getStore } from "../store";

const RegisterSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_\-.]+$/),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(80).optional()
});

const LoginSchema = z.object({
  username: z.string().trim().min(3).max(32),
  password: z.string().min(8).max(200)
});

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
      displayName: input.displayName ?? null
    });

    await setAuthCookies(reply, { sub: user.id });
    return reply.send({ user });
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

    await setAuthCookies(reply, { sub: user.id });
    return reply.send({
      user: { id: user.id, username: user.username, displayName: user.displayName }
    });
  });

  app.post("/auth/refresh", async (req, reply) => {
    try {
      const payload = await (req as any).jwtVerify({
        secret: env.JWT_REFRESH_SECRET,
        cookie: { cookieName: REFRESH_COOKIE }
      });
      const userId = payload.sub as string;
      await setAuthCookies(reply, { sub: userId });
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

  app.get("/me", async (req, reply) => {
    try {
      const payload = await (req as any).jwtVerify({ cookie: { cookieName: ACCESS_COOKIE } });
      const userId = payload.sub as string;
      const store = getStore();
      const user = await store.userFindById(userId);
      if (!user) return reply.code(401).send({ error: "unauthorized" });
      return reply.send({ user });
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });
}
