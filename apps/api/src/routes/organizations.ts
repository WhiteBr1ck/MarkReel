import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { auditLog } from "../audit";
import { getCurrentUser, requireAdmin, requireUser } from "../auth/requireUser";

const CreateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const UpdateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(120)
});

const AddOrganizationMemberSchema = z.object({
  username: z.string().trim().min(1).max(80),
  role: z.enum(["owner", "admin", "member"]).default("member")
});

const UpdateOrganizationMemberSchema = z.object({
  role: z.enum(["owner", "admin", "member"])
});

const UserSearchSchema = z.object({
  q: z.string().trim().max(80).optional()
});

const SetOrganizationOwnerSchema = z.object({
  userId: z.string().optional(),
  username: z.string().trim().min(1).max(80).optional()
}).refine((value) => Boolean(value.userId || value.username), { message: "owner_required" });

const organizationWithOwnerInclude = {
  members: {
    where: { role: "owner" as const, user: { deletedAt: null } },
    include: { user: { select: { id: true, username: true, displayName: true, avatarPreset: true } } },
    orderBy: { createdAt: "asc" as const },
    take: 1
  }
};

function serializeOrganization(org: any) {
  const owner = org.members?.[0]?.user;
  return {
    id: org.id,
    name: org.name,
    owner: owner ? { id: owner.id, username: owner.username, displayName: owner.displayName, avatarPreset: owner.avatarPreset } : null,
    createdById: org.createdById,
    createdAt: org.createdAt,
    updatedAt: org.updatedAt,
    deletedAt: org.deletedAt
  };
}

async function requireOrganizationManager(req: any, reply: any, organizationId: string) {
  const actor = getCurrentUser(req);
  if (actor.globalRole === "admin") return actor;
  const membership = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: actor.id } } });
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return actor;
}

async function findActiveUser(input: { userId?: string; username?: string | null }) {
  if (input.userId) return prisma.user.findFirst({ where: { id: input.userId, deletedAt: null }, select: { id: true } });
  if (input.username) return prisma.user.findFirst({ where: { username: input.username.toLowerCase(), deletedAt: null }, select: { id: true } });
  return null;
}

async function assertCanChangeOwnerRole(organizationId: string, memberUserId: string, nextRole?: "owner" | "admin" | "member") {
  const current = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: memberUserId } }, select: { role: true } });
  if (!current || current.role !== "owner" || nextRole === "owner") return true;
  const ownerCount = await prisma.organizationMember.count({ where: { organizationId, role: "owner" } });
  return ownerCount > 1;
}

function serializeMember(member: any) {
  return {
    userId: member.user.id,
    username: member.user.username,
    displayName: member.user.displayName,
    avatarPreset: member.user.avatarPreset,
    role: member.role,
    createdAt: member.createdAt
  };
}

function serializeUserSearchResult(user: any) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarPreset: user.avatarPreset
  };
}

export async function organizationRoutes(app: FastifyInstance) {
  app.get("/organizations", { preHandler: requireUser }, async (req) => {
    const actor = getCurrentUser(req);
    if (actor.globalRole === "admin") {
      const organizations = await prisma.organization.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" }, include: organizationWithOwnerInclude });
      return { organizations: organizations.map(serializeOrganization) };
    }

    const memberships = await prisma.organizationMember.findMany({
      where: { userId: actor.id, organization: { deletedAt: null } },
      orderBy: { organization: { name: "asc" } },
      include: { organization: { include: organizationWithOwnerInclude } }
    });
    return { organizations: memberships.map((membership) => serializeOrganization(membership.organization)) };
  });

  app.get("/organizations/mine", { preHandler: requireUser }, async (req) => {
    const actor = getCurrentUser(req);
    const memberships = await prisma.organizationMember.findMany({
      where: { userId: actor.id, organization: { deletedAt: null } },
      orderBy: { organization: { name: "asc" } },
      include: { organization: { include: organizationWithOwnerInclude } }
    });
    return {
      organizations: memberships.map((membership) => ({
        ...serializeOrganization(membership.organization),
        myRole: membership.role
      }))
    };
  });

  app.post("/admin/organizations", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const input = CreateOrganizationSchema.parse(req.body);
    const organization = await prisma.organization.create({
      data: {
        name: input.name,
        createdById: actor.id,
        members: { create: { userId: actor.id, role: "owner" } }
      },
      include: organizationWithOwnerInclude
    });
    await auditLog({ req, actorUserId: actor.id, action: "organization.create", entityType: "Organization", entityId: organization.id, meta: { name: organization.name } });
    return reply.code(201).send({ organization: serializeOrganization(organization) });
  });

  app.patch("/admin/organizations/:organizationId", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const organizationId = (req.params as any).organizationId as string;
    const input = UpdateOrganizationSchema.parse(req.body);
    const organization = await prisma.organization.update({ where: { id: organizationId }, data: { name: input.name }, include: organizationWithOwnerInclude }).catch(() => null);
    if (!organization || organization.deletedAt) return reply.code(404).send({ error: "not_found" });
    await auditLog({ req, actorUserId: actor.id, action: "organization.update", entityType: "Organization", entityId: organization.id, meta: { name: organization.name } });
    return { organization: serializeOrganization(organization) };
  });

  app.post("/admin/organizations/:organizationId/owner", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const organizationId = (req.params as any).organizationId as string;
    const input = SetOrganizationOwnerSchema.parse(req.body);
    const user = await findActiveUser(input);
    if (!user) return reply.code(404).send({ error: "user_not_found" });

    const existing = await prisma.organization.findFirst({ where: { id: organizationId, deletedAt: null }, select: { id: true } });
    if (!existing) return reply.code(404).send({ error: "not_found" });

    const organization = await prisma.$transaction(async (tx) => {
      await tx.organizationMember.updateMany({ where: { organizationId, role: "owner" }, data: { role: "admin" } });
      await tx.organizationMember.upsert({
        where: { organizationId_userId: { organizationId, userId: user.id } },
        update: { role: "owner" },
        create: { organizationId, userId: user.id, role: "owner" }
      });
      return tx.organization.findUnique({ where: { id: organizationId }, include: organizationWithOwnerInclude });
    });

    await auditLog({ req, actorUserId: actor.id, action: "organization_owner.set", entityType: "Organization", entityId: organizationId, meta: { ownerUserId: user.id } });
    return { organization: serializeOrganization(organization) };
  });

  app.patch("/organizations/:organizationId", { preHandler: requireUser }, async (req, reply) => {
    const organizationId = (req.params as any).organizationId as string;
    const actor = await requireOrganizationManager(req, reply, organizationId);
    if (!actor) return;
    const input = UpdateOrganizationSchema.parse(req.body);
    const organization = await prisma.organization.update({ where: { id: organizationId }, data: { name: input.name }, include: organizationWithOwnerInclude }).catch(() => null);
    if (!organization || organization.deletedAt) return reply.code(404).send({ error: "not_found" });
    await auditLog({ req, actorUserId: actor.id, action: "organization.self_update", entityType: "Organization", entityId: organization.id, meta: { name: organization.name } });
    return { organization: serializeOrganization(organization) };
  });

  app.delete("/admin/organizations/:organizationId", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const organizationId = (req.params as any).organizationId as string;
    const projectCount = await prisma.project.count({ where: { organizationId, deletedAt: null } });
    if (projectCount > 0) return reply.code(409).send({ error: "organization_has_projects" });
    const organization = await prisma.organization.update({ where: { id: organizationId }, data: { deletedAt: new Date() } }).catch(() => null);
    if (!organization) return reply.code(404).send({ error: "not_found" });
    await auditLog({ req, actorUserId: actor.id, action: "organization.delete", entityType: "Organization", entityId: organizationId });
    return { ok: true };
  });

  app.get("/organizations/:organizationId/members", { preHandler: requireUser }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const organizationId = (req.params as any).organizationId as string;
    if (actor.globalRole !== "admin") {
      const membership = await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId: actor.id } } });
      if (!membership) return reply.code(404).send({ error: "not_found" });
    }

    const members = await prisma.organizationMember.findMany({
      where: { organizationId, user: { deletedAt: null } },
      orderBy: [{ role: "asc" }, { createdAt: "asc" }],
      include: { user: { select: { id: true, username: true, displayName: true, avatarPreset: true } } }
    });
    return { members: members.map(serializeMember) };
  });

  app.get("/organizations/:organizationId/user-search", { preHandler: requireUser }, async (req, reply) => {
    const organizationId = (req.params as any).organizationId as string;
    const actor = await requireOrganizationManager(req, reply, organizationId);
    if (!actor) return;

    const input = UserSearchSchema.parse(req.query);
    const query = input.q?.toLowerCase() ?? "";
    const users = await prisma.user.findMany({
      where: {
        deletedAt: null,
        disabledAt: null,
        organizationMemberships: { none: { organizationId } },
        ...(query
          ? {
              OR: [
                { username: { contains: query } },
                { displayName: { contains: query } }
              ]
            }
          : {})
      },
      orderBy: [{ lastLoginAt: "desc" }, { username: "asc" }],
      take: 12,
      select: { id: true, username: true, displayName: true, avatarPreset: true }
    });

    return { users: users.map(serializeUserSearchResult) };
  });

  app.post("/admin/organizations/:organizationId/members", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const organizationId = (req.params as any).organizationId as string;
    const input = AddOrganizationMemberSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: input.username.toLowerCase() }, select: { id: true, deletedAt: true } });
    if (!user || user.deletedAt) return reply.code(404).send({ error: "user_not_found" });
    const member = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      update: { role: input.role },
      create: { organizationId, userId: user.id, role: input.role },
      include: { user: { select: { id: true, username: true, displayName: true, avatarPreset: true } } }
    });
    await auditLog({ req, actorUserId: actor.id, action: "organization_member.upsert", entityType: "Organization", entityId: organizationId, meta: { memberUserId: user.id, role: input.role } });
    return reply.code(201).send({ member: serializeMember(member) });
  });

  app.post("/organizations/:organizationId/members", { preHandler: requireUser }, async (req, reply) => {
    const organizationId = (req.params as any).organizationId as string;
    const actor = await requireOrganizationManager(req, reply, organizationId);
    if (!actor) return;
    const input = AddOrganizationMemberSchema.parse(req.body);
    const user = await findActiveUser({ username: input.username });
    if (!user) return reply.code(404).send({ error: "user_not_found" });
    const member = await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      update: { role: input.role },
      create: { organizationId, userId: user.id, role: input.role },
      include: { user: { select: { id: true, username: true, displayName: true, avatarPreset: true } } }
    });
    await auditLog({ req, actorUserId: actor.id, action: "organization_member.self_upsert", entityType: "Organization", entityId: organizationId, meta: { memberUserId: user.id, role: input.role } });
    return reply.code(201).send({ member: serializeMember(member) });
  });

  app.patch("/admin/organizations/:organizationId/members/:memberUserId", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const organizationId = (req.params as any).organizationId as string;
    const memberUserId = (req.params as any).memberUserId as string;
    const input = UpdateOrganizationMemberSchema.parse(req.body);
    const canChange = await assertCanChangeOwnerRole(organizationId, memberUserId, input.role);
    if (!canChange) return reply.code(400).send({ error: "last_owner_required" });
    const member = await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: memberUserId } },
      data: { role: input.role },
      include: { user: { select: { id: true, username: true, displayName: true, avatarPreset: true } } }
    }).catch(() => null);
    if (!member) return reply.code(404).send({ error: "member_not_found" });
    await auditLog({ req, actorUserId: actor.id, action: "organization_member.update", entityType: "Organization", entityId: organizationId, meta: { memberUserId, role: input.role } });
    return { member: serializeMember(member) };
  });

  app.patch("/organizations/:organizationId/members/:memberUserId", { preHandler: requireUser }, async (req, reply) => {
    const organizationId = (req.params as any).organizationId as string;
    const memberUserId = (req.params as any).memberUserId as string;
    const actor = await requireOrganizationManager(req, reply, organizationId);
    if (!actor) return;
    const input = UpdateOrganizationMemberSchema.parse(req.body);
    const canChange = await assertCanChangeOwnerRole(organizationId, memberUserId, input.role);
    if (!canChange) return reply.code(400).send({ error: "last_owner_required" });
    const member = await prisma.organizationMember.update({
      where: { organizationId_userId: { organizationId, userId: memberUserId } },
      data: { role: input.role },
      include: { user: { select: { id: true, username: true, displayName: true, avatarPreset: true } } }
    }).catch(() => null);
    if (!member) return reply.code(404).send({ error: "member_not_found" });
    await auditLog({ req, actorUserId: actor.id, action: "organization_member.self_update", entityType: "Organization", entityId: organizationId, meta: { memberUserId, role: input.role } });
    return { member: serializeMember(member) };
  });

  app.delete("/admin/organizations/:organizationId/members/:memberUserId", { preHandler: requireAdmin }, async (req, reply) => {
    const actor = getCurrentUser(req);
    const organizationId = (req.params as any).organizationId as string;
    const memberUserId = (req.params as any).memberUserId as string;
    const canChange = await assertCanChangeOwnerRole(organizationId, memberUserId);
    if (!canChange) return reply.code(400).send({ error: "last_owner_required" });
    await prisma.organizationMember.deleteMany({ where: { organizationId, userId: memberUserId } });
    await auditLog({ req, actorUserId: actor.id, action: "organization_member.delete", entityType: "Organization", entityId: organizationId, meta: { memberUserId } });
    return { ok: true };
  });

  app.delete("/organizations/:organizationId/members/:memberUserId", { preHandler: requireUser }, async (req, reply) => {
    const organizationId = (req.params as any).organizationId as string;
    const memberUserId = (req.params as any).memberUserId as string;
    const actor = await requireOrganizationManager(req, reply, organizationId);
    if (!actor) return;
    const canChange = await assertCanChangeOwnerRole(organizationId, memberUserId);
    if (!canChange) return reply.code(400).send({ error: "last_owner_required" });
    await prisma.organizationMember.deleteMany({ where: { organizationId, userId: memberUserId } });
    await auditLog({ req, actorUserId: actor.id, action: "organization_member.self_delete", entityType: "Organization", entityId: organizationId, meta: { memberUserId } });
    return { ok: true };
  });
}
