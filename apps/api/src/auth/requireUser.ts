import type { FastifyReply, FastifyRequest } from "fastify";
import { ACCESS_COOKIE } from "./tokens";

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await (req as any).jwtVerify({ cookie: { cookieName: ACCESS_COOKIE } });
    (req as any).user = { id: payload.sub as string };
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
}

export function getUserId(req: FastifyRequest): string {
  const user = (req as any).user;
  if (!user?.id) throw new Error("missing_user");
  return user.id;
}
