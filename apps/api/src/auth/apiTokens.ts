import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import { getStore } from "../store";

export function hashApiToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateApiToken() {
  const token = `mr_token_${randomBytes(32).toString("base64url")}`;
  return { token, tokenHash: hashApiToken(token), prefix: token.slice(0, 17) };
}

export function bearerApiToken(req: FastifyRequest) {
  const match = /^Bearer (mr_token_[A-Za-z0-9_-]{43})$/i.exec(req.headers.authorization ?? "");
  return match?.[1] ?? null;
}

export async function resolveApiToken(token: string) {
  const store = getStore();
  const record = await store.apiTokenFind(hashApiToken(token));
  if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) return null;
  const user = await store.userFindById(record.userId);
  if (!user || user.disabledAt || user.sessionVersion !== record.sessionVersion) return null;
  if (!record.lastUsedAt || record.lastUsedAt.getTime() < Date.now() - 60_000) {
    await store.apiTokenTouch(record.id);
  }
  return { record, user };
}

declare module "fastify" {
  interface FastifyRequest {
    apiTokenReadOnly?: boolean;
  }
}
