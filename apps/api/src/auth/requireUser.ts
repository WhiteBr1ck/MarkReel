import type { FastifyReply, FastifyRequest } from "fastify";
import { getStore } from "../store";
import { ACCESS_COOKIE, authInstanceId, clearAccessCookie, parseAuthTokenPayload } from "./tokens";
import type { UserGlobalRole } from "../store/types";

export type CurrentUser = {
  id: string;
  username: string;
  displayName: string | null;
  avatarObjectKey: string | null;
  avatarContentType: string | null;
  avatarPreset: string | null;
  globalRole: UserGlobalRole;
  createdAt: Date;
};

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    const rawPayload = await (req as any).jwtVerify({ cookie: { cookieName: ACCESS_COOKIE } });
    const payload = parseAuthTokenPayload(rawPayload);
    if (!payload || payload.si !== authInstanceId) {
      clearAccessCookie(reply);
      return reply.code(401).send({ error: "unauthorized" });
    }

    const user = await getStore().userFindById(payload.sub);
    if (!user || user.disabledAt || user.sessionVersion !== payload.sv) {
      clearAccessCookie(reply);
      return reply.code(401).send({ error: "unauthorized" });
    }

    (req as any).user = {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      avatarObjectKey: user.avatarObjectKey,
      avatarContentType: user.avatarContentType,
      avatarPreset: user.avatarPreset,
      globalRole: user.globalRole,
      createdAt: user.createdAt
    } satisfies CurrentUser;
  } catch {
    clearAccessCookie(reply);
    return reply.code(401).send({ error: "unauthorized" });
  }
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
  const result = await requireUser(req, reply);
  if (reply.sent) return result;
  if (getCurrentUser(req).globalRole !== "admin") {
    return reply.code(403).send({ error: "forbidden" });
  }
}

export function getCurrentUser(req: FastifyRequest): CurrentUser {
  const user = (req as any).user as CurrentUser | undefined;
  if (!user?.id) throw new Error("missing_user");
  return user;
}

export function getUserId(req: FastifyRequest): string {
  return getCurrentUser(req).id;
}
