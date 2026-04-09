import type { FastifyRequest } from "fastify";
import { prisma } from "./db";
import { env } from "./env";

export async function auditLog(args: {
  req?: FastifyRequest;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  meta?: any;
}) {
  if (env.MARKREEL_STORE === "inmemory") {
    return;
  }
  const ip = args.req?.ip;
  return prisma.auditLog.create({
    data: {
      actorUserId: args.actorUserId ?? null,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      meta: args.meta ?? null,
      ip: ip ?? null
    }
  });
}
