import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { auditLog } from "../audit";
import { getProjectAccess, hasCapability, type ProjectRole } from "../access";
import { getUserId, requireUser } from "../auth/requireUser";

const MemberRoleSchema = z.enum(["editor", "commenter", "viewer"]);

const AddMemberSchema = z.object({
  username: z.string().trim().min(1).max(80),
  role: MemberRoleSchema
});

const UpdateMemberSchema = z.object({
  role: MemberRoleSchema
});

function serializeMember(member: {
  role: ProjectRole;
  createdAt: Date;
  user: { id: string; username: string; displayName: string | null; avatarPreset: string | null; avatarObjectKey: string | null; avatarContentType: string | null };
}) {
  return {
    userId: member.user.id,
    username: member.user.username,
    displayName: member.user.displayName,
    avatarPreset: member.user.avatarPreset,
    avatarObjectKey: member.user.avatarObjectKey,
    avatarContentType: member.user.avatarContentType,
    role: member.role,
    createdAt: member.createdAt
  };
}

async function requireMemberManagement(userId: string, projectId: string, reply: any) {
  const access = await getProjectAccess({ userId, projectId });
  if (!access) {
    reply.code(404).send({ error: "not_found" });
    return null;
  }
  if (!hasCapability(access, "project:manage_members")) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return access;
}

export async function projectMemberRoutes(app: FastifyInstance) {
  app.get("/projects/:projectId/members", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const access = await getProjectAccess({ userId, projectId });
    if (!access) return reply.code(404).send({ error: "not_found" });

    const members = await prisma.projectMember.findMany({
      where: { projectId },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      select: {
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            avatarPreset: true,
            avatarObjectKey: true,
            avatarContentType: true
          }
        }
      }
    });

    return { members: members.map((member) => serializeMember(member as any)) };
  });

  app.post("/projects/:projectId/members", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const input = AddMemberSchema.parse(req.body);
    const access = await requireMemberManagement(userId, projectId, reply);
    if (!access) return;

    const user = await prisma.user.findUnique({
      where: { username: input.username.toLowerCase() },
      select: { id: true, username: true, displayName: true, avatarPreset: true, avatarObjectKey: true, avatarContentType: true, deletedAt: true }
    });
    if (!user || user.deletedAt) return reply.code(404).send({ error: "user_not_found" });

    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { ownerId: true } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    if (project.ownerId === user.id) return reply.code(400).send({ error: "owner_role_locked" });

    const member = await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId, userId: user.id } },
      update: { role: input.role },
      create: { projectId, userId: user.id, role: input.role },
      select: {
        role: true,
        createdAt: true,
        user: {
          select: { id: true, username: true, displayName: true, avatarPreset: true, avatarObjectKey: true, avatarContentType: true }
        }
      }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "project_member.upsert",
      entityType: "Project",
      entityId: projectId,
      meta: { memberUserId: user.id, role: input.role }
    });

    return reply.code(201).send({ member: serializeMember(member as any) });
  });

  app.patch("/projects/:projectId/members/:memberUserId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const memberUserId = (req.params as any).memberUserId as string;
    const input = UpdateMemberSchema.parse(req.body);
    const access = await requireMemberManagement(userId, projectId, reply);
    if (!access) return;

    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { ownerId: true } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    if (project.ownerId === memberUserId) return reply.code(400).send({ error: "owner_role_locked" });

    const existing = await prisma.projectMember.findUnique({ where: { projectId_userId: { projectId, userId: memberUserId } } });
    if (!existing) return reply.code(404).send({ error: "member_not_found" });

    const member = await prisma.projectMember.update({
      where: { projectId_userId: { projectId, userId: memberUserId } },
      data: { role: input.role },
      select: {
        role: true,
        createdAt: true,
        user: { select: { id: true, username: true, displayName: true, avatarPreset: true, avatarObjectKey: true, avatarContentType: true } }
      }
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "project_member.update",
      entityType: "Project",
      entityId: projectId,
      meta: { memberUserId, role: input.role }
    });

    return { member: serializeMember(member as any) };
  });

  app.delete("/projects/:projectId/members/:memberUserId", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const projectId = (req.params as any).projectId as string;
    const memberUserId = (req.params as any).memberUserId as string;
    const access = await requireMemberManagement(userId, projectId, reply);
    if (!access) return;

    const project = await prisma.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { ownerId: true } });
    if (!project) return reply.code(404).send({ error: "not_found" });
    if (project.ownerId === memberUserId) return reply.code(400).send({ error: "owner_role_locked" });

    await prisma.projectMember.deleteMany({ where: { projectId, userId: memberUserId } });

    await auditLog({
      req,
      actorUserId: userId,
      action: "project_member.delete",
      entityType: "Project",
      entityId: projectId,
      meta: { memberUserId }
    });

    return { ok: true };
  });
}
