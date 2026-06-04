import type { FastifyReply } from "fastify";
import { prisma } from "./db";

export type ProjectRole = "owner" | "editor" | "commenter" | "viewer";

export type ProjectCapability =
  | "project:view"
  | "project:comment"
  | "project:annotate"
  | "project:edit_assets"
  | "project:manage_members"
  | "project:manage_share_links"
  | "project:manage_org_shares"
  | "project:delete";

export type ProjectAccess = {
  projectId: string;
  role: ProjectRole;
  accessSource: "owner" | "member";
  capabilities: ProjectCapability[];
};

const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4
};

const ROLE_CAPABILITIES: Record<ProjectRole, ProjectCapability[]> = {
  owner: [
    "project:view",
    "project:comment",
    "project:annotate",
    "project:edit_assets",
    "project:manage_members",
    "project:manage_share_links",
    "project:manage_org_shares",
    "project:delete"
  ],
  editor: ["project:view", "project:comment", "project:annotate", "project:edit_assets"],
  commenter: ["project:view", "project:comment", "project:annotate"],
  viewer: ["project:view"]
};

export function capabilitiesForRole(role: ProjectRole) {
  return ROLE_CAPABILITIES[role];
}

export function hasCapability(access: ProjectAccess | null | undefined, capability: ProjectCapability) {
  return !!access?.capabilities.includes(capability);
}

export function strongerRole(a: ProjectRole, b: ProjectRole) {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

export async function getProjectAccess(args: { userId: string; projectId: string }): Promise<ProjectAccess | null> {
  const project = await prisma.project.findFirst({
    where: { id: args.projectId, deletedAt: null },
    select: {
      id: true,
      ownerId: true,
      members: {
        where: { userId: args.userId },
        select: { role: true },
        take: 1
      }
    }
  });

  if (!project) return null;
  if (project.ownerId === args.userId) {
    return {
      projectId: project.id,
      role: "owner",
      accessSource: "owner",
      capabilities: capabilitiesForRole("owner")
    };
  }

  const memberRole = project.members[0]?.role as ProjectRole | undefined;
  if (!memberRole) return null;

  return {
    projectId: project.id,
    role: memberRole,
    accessSource: "member",
    capabilities: capabilitiesForRole(memberRole)
  };
}

export async function getMediaProjectAccess(args: { userId: string; mediaId: string; includeDeleted?: boolean }) {
  const media = await prisma.media.findFirst({
    where: {
      id: args.mediaId,
      ...(args.includeDeleted ? {} : { deletedAt: null }),
      project: { deletedAt: null }
    },
    select: { id: true, projectId: true, deletedAt: true }
  });
  if (!media) return null;
  const access = await getProjectAccess({ userId: args.userId, projectId: media.projectId });
  if (!access) return null;
  return { media, access };
}

export async function getAnnotationProjectAccess(args: { userId: string; annotationId: string }) {
  const annotation = await prisma.annotation.findFirst({
    where: {
      id: args.annotationId,
      deletedAt: null,
      media: {
        deletedAt: null,
        project: { deletedAt: null }
      }
    },
    select: { id: true, mediaId: true, projectId: true, parentId: true, authorId: true }
  });
  if (!annotation) return null;
  const access = await getProjectAccess({ userId: args.userId, projectId: annotation.projectId });
  if (!access) return null;
  return { annotation, access };
}

export function denyMissingAccess(reply: FastifyReply) {
  return reply.code(404).send({ error: "not_found" });
}

export function denyMissingCapability(reply: FastifyReply) {
  return reply.code(403).send({ error: "forbidden" });
}
