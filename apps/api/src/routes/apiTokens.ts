import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getUserId, requireUser } from "../auth/requireUser";
import { generateApiToken } from "../auth/apiTokens";
import { getStore } from "../store";
import { auditLog } from "../audit";
import type { StoreApiToken } from "../store/types";

const CreateTokenSchema = z.object({
  name: z.string().trim().min(1).max(80),
  readOnly: z.boolean().default(false),
  expiresInDays: z.number().int().min(1).max(365).default(90)
});

function serialize(token: StoreApiToken) {
  return { id: token.id, name: token.name, prefix: token.prefix, readOnly: token.readOnly,
    createdAt: token.createdAt, expiresAt: token.expiresAt, lastUsedAt: token.lastUsedAt };
}

export async function apiTokenRoutes(app: FastifyInstance) {
  app.get("/users/me/api-tokens", { preHandler: requireUser }, async (req) => ({ tokens: (await getStore().apiTokenList(getUserId(req))).map(serialize) }));
  app.post("/users/me/api-tokens", { preHandler: requireUser }, async (req, reply) => {
    const input = CreateTokenSchema.parse(req.body);
    const store = getStore();
    const userId = getUserId(req);
    const user = await store.userFindById(userId);
    if (!user) return reply.code(401).send({ error: "unauthorized" });
    if ((await store.apiTokenList(userId)).filter((token) => token.expiresAt.getTime() > Date.now()).length >= 30) {
      return reply.code(409).send({ error: "token_limit_reached" });
    }
    const generated = generateApiToken();
    const record = await store.apiTokenCreate({ userId, name: input.name, tokenHash: generated.tokenHash, prefix: generated.prefix,
      readOnly: input.readOnly, sessionVersion: user.sessionVersion, expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000) });
    await auditLog({ req, actorUserId: userId, action: "api_token.create", entityType: "ApiAccessToken", entityId: record.id, meta: { name: input.name, readOnly: input.readOnly } });
    return reply.code(201).header("cache-control", "no-store").send({ token: generated.token, apiToken: serialize(record) });
  });
  app.delete("/users/me/api-tokens/:tokenId", { preHandler: requireUser }, async (req, reply) => {
    const { tokenId } = z.object({ tokenId: z.string().min(1) }).parse(req.params);
    const userId = getUserId(req);
    if (!await getStore().apiTokenRevoke({ userId, tokenId })) return reply.code(404).send({ error: "not_found" });
    await auditLog({ req, actorUserId: userId, action: "api_token.revoke", entityType: "ApiAccessToken", entityId: tokenId });
    return { ok: true };
  });
}
