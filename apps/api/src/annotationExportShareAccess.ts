import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { authInstanceId } from "./auth/tokens";
import { prisma } from "./db";
import { env } from "./env";
import { sha256Hex } from "./share";
import { AnnotationExportError } from "./annotationExport";

const visitTtlSeconds = 30 * 60;
const shareVisitSelect = {
  id: true, tokenHash: true, projectId: true, mediaId: true, audience: true, passwordHash: true,
  revokedAt: true, expiresAt: true, maxUses: true, useCount: true
} as const;
type ShareVisitLink = Awaited<ReturnType<typeof findVisitLink>>;
type ActiveShareVisitLink = NonNullable<ShareVisitLink>;

function findVisitLink(token: string) {
  return prisma.shareLink.findUnique({ where: { tokenHash: sha256Hex(token) }, select: shareVisitSelect });
}

function visitCookieName(linkId: string) { return `mr_export_visit_${sha256Hex(linkId).slice(0, 16)}`; }

function visitSignature(link: ActiveShareVisitLink, count: string, timestamp: string) {
  return createHmac("sha256", env.JWT_ACCESS_SECRET).update(JSON.stringify([
    "annotation-export-visit", authInstanceId, link.id, link.tokenHash, link.projectId, link.mediaId,
    link.audience, link.passwordHash, count, timestamp
  ])).digest("hex");
}

function setVisitCookie(reply: FastifyReply, link: ActiveShareVisitLink) {
  const count = String(link.useCount);
  const timestamp = String(Date.now());
  reply.setCookie(visitCookieName(link.id), `${count}.${timestamp}.${visitSignature(link, count, timestamp)}`, {
    path: "/", httpOnly: true, sameSite: "lax", secure: env.WEB_BASE_URL.startsWith("https://"), maxAge: visitTtlSeconds
  });
}

// Admission proof only: callers must still check live scope, revocation, expiry, password, audience and permissions.
export function hasAnnotationExportShareVisit(req: FastifyRequest, link: ActiveShareVisitLink) {
  const cookie = req.cookies?.[visitCookieName(link.id)];
  if (!cookie) return false;
  const parts = cookie.split(".");
  if (parts.length !== 3) return false;
  const [count, timestamp, signature] = parts as [string, string, string];
  if (!/^[1-9]\d{0,9}$/.test(count) || !/^\d{13}$/.test(timestamp) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  const age = Date.now() - Number(timestamp);
  if (age < 0 || age > visitTtlSeconds * 1000 || Number(count) > link.useCount || (link.maxUses !== null && Number(count) > link.maxUses)) return false;
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(visitSignature(link, count, timestamp), "hex"));
}

export async function requireAnnotationExportShareVisit(req: FastifyRequest, reply: FastifyReply, link: ActiveShareVisitLink) {
  if (link.maxUses === null || hasAnnotationExportShareVisit(req, link)) return;
  if (link.useCount >= link.maxUses) throw new AnnotationExportError("max_uses_reached", 410);
  // Direct API exports admit one visit atomically; polling and downloads reuse its proof.
  const admitted = await prisma.shareLink.updateMany({ where: {
    id: link.id, tokenHash: link.tokenHash, useCount: link.useCount, maxUses: link.maxUses,
    revokedAt: null, expiresAt: link.expiresAt, passwordHash: link.passwordHash, audience: link.audience,
    mediaId: link.mediaId, projectId: link.projectId
  }, data: { useCount: { increment: 1 }, lastUsedAt: new Date() } });
  if (admitted.count !== 1) throw new AnnotationExportError("max_uses_reached", 410);
  setVisitCookie(reply, { ...link, useCount: link.useCount + 1 });
}

export function registerAnnotationExportShareVisits(app: FastifyInstance) {
  app.addHook("onSend", async (req, reply, payload) => {
    const route = req.routeOptions.url ?? "";
    if (reply.statusCode !== 200 || !(route.endsWith("/share/:token/media") && req.method === "GET"
      || route.endsWith("/share/:token/access") && req.method === "POST")) return payload;
    const params = z.object({ token: z.string().min(1).max(256) }).safeParse(req.params);
    if (!params.success || typeof payload !== "string") return payload;
    let response: unknown;
    try { response = JSON.parse(payload); } catch { return payload; }
    const result = z.object({ share: z.object({ id: z.string(), mediaId: z.string().nullable(), projectId: z.string().nullable() }) }).safeParse(response);
    if (!result.success) return payload;
    const link = await findVisitLink(params.data.token);
    if (!link || link.maxUses === null || link.useCount < 1 || link.useCount > link.maxUses || link.revokedAt
      || link.expiresAt && link.expiresAt.getTime() <= Date.now()) return payload;
    if (result.data.share.id !== link.id || result.data.share.mediaId !== link.mediaId || result.data.share.projectId !== link.projectId) return payload;
    // The existing entry routes have already admitted and counted this exact visit.
    // Its export proof never overrides live revocation, password, audience or permission checks.
    setVisitCookie(reply, link);
    reply.header("cache-control", "private, no-store");
    return payload;
  });
}
