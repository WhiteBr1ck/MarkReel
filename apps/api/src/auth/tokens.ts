import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { env } from "../env";

export const ACCESS_COOKIE = "mr_access";
export const REFRESH_COOKIE = "mr_refresh";
export const authInstanceId = env.JWT_AUTH_INSTANCE_ID ?? createHash("sha256").update(env.JWT_REFRESH_SECRET).digest("hex").slice(0, 32);

export type AuthTokenPayload = {
  sub: string;
  sv: number;
  si: string;
};

export async function registerJwt(app: FastifyInstance) {
  await app.register(import("@fastify/jwt"), {
    secret: env.JWT_ACCESS_SECRET,
    cookie: {
      cookieName: ACCESS_COOKIE,
      signed: false
    }
  });
}

export function parseAuthTokenPayload(payload: unknown): AuthTokenPayload | null {
  if (!payload || typeof payload !== "object") return null;
  const value = payload as Record<string, unknown>;
  if (typeof value.sub !== "string") return null;
  if (typeof value.sv !== "number" || !Number.isInteger(value.sv)) return null;
  if (typeof value.si !== "string") return null;
  return {
    sub: value.sub,
    sv: value.sv,
    si: value.si
  };
}

export async function setAuthCookies(reply: any, payload: { userId: string; sessionVersion: number }) {
  const tokenPayload: AuthTokenPayload = {
    sub: payload.userId,
    sv: payload.sessionVersion,
    si: authInstanceId
  };

  const accessToken = await reply.jwtSign(tokenPayload, {
    expiresIn: env.JWT_ACCESS_TTL_SECONDS
  });
  const refreshToken = await reply.jwtSign(tokenPayload, {
    expiresIn: env.JWT_REFRESH_TTL_SECONDS,
    secret: env.JWT_REFRESH_SECRET
  });

  reply.setCookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false,
    maxAge: env.JWT_ACCESS_TTL_SECONDS
  });
  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/auth/refresh",
    secure: false,
    maxAge: env.JWT_REFRESH_TTL_SECONDS
  });
}

export function clearAuthCookies(reply: any) {
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth/refresh" });
}
