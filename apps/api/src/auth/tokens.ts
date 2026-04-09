import type { FastifyInstance } from "fastify";
import { env } from "../env";

export const ACCESS_COOKIE = "mr_access";
export const REFRESH_COOKIE = "mr_refresh";

export async function registerJwt(app: FastifyInstance) {
  await app.register(import("@fastify/jwt"), {
    secret: env.JWT_ACCESS_SECRET,
    cookie: {
      cookieName: ACCESS_COOKIE,
      signed: false
    }
  });
}

export async function setAuthCookies(reply: any, payload: { sub: string }) {
  const accessToken = await reply.jwtSign(payload, {
    expiresIn: env.JWT_ACCESS_TTL_SECONDS
  });
  const refreshToken = await reply.jwtSign(payload, {
    expiresIn: env.JWT_REFRESH_TTL_SECONDS,
    secret: env.JWT_REFRESH_SECRET
  });

  reply.setCookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: false
  });
  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/api/auth/refresh",
    secure: false
  });
}

export function clearAuthCookies(reply: any) {
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth/refresh" });
}
