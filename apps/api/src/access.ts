import type { FastifyReply } from "fastify";
import { prisma } from "./db";

export type ProjectRole = "owner" | "editor" | "commenter" | "viewer";
export type ProjectPermission = "manage" | "upload" | "view";
export type MediaPermission = "manage" | "annotate" | "view";
export type PermissionSubjectType = "creator" | "organization" | "invited_user" | "public";

export type ProjectCapability =
  | "project:view"
  | "project:upload"
  | "project:comment"
  | "project:annotate"
  | "project:edit_assets"
  | "project:manage_members"
  | "project:manage_share_links"
  | "project:manage_org_shares"
  | "project:delete";

export type MediaCapability =
  | "media:view"
  | "media:annotate"
  | "media:manage"
  | "media:complete_own_annotations"
  | "media:complete_any_annotation";

export type ProjectAccess = {
  projectId: string;
  role: ProjectRole;
  permissions: ProjectPermission[];
  accessSource: "admin" | "owner" | "project_grant" | "legacy_member";
  capabilities: ProjectCapability[];
};

export type MediaAccess = {
  mediaId: string;
  projectId: string;
  permissions: MediaPermission[];
  capabilities: MediaCapability[];
  projectAccess: ProjectAccess;
};

const ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4
};

const PROJECT_PERMISSION_RANK: Record<ProjectPermission, number> = {
  view: 1,
  upload: 2,
  manage: 3
};

const MEDIA_PERMISSION_RANK: Record<MediaPermission, number> = {
  view: 1,
  annotate: 2,
  manage: 3
};

const ROLE_PROJECT_PERMISSIONS: Record<ProjectRole, ProjectPermission[]> = {
  owner: ["manage", "upload", "view"],
  editor: ["upload", "view"],
  commenter: ["view"],
  viewer: ["view"]
};

const PROJECT_PERMISSION_CAPABILITIES: Record<ProjectPermission, ProjectCapability[]> = {
  manage: [
    "project:view",
    "project:upload",
    "project:comment",
    "project:annotate",
    "project:edit_assets",
    "project:manage_members",
    "project:manage_share_links",
    "project:manage_org_shares",
    "project:delete"
  ],
  upload: ["project:view", "project:upload", "project:comment", "project:annotate", "project:edit_assets"],
  view: ["project:view"]
};

const MEDIA_PERMISSION_CAPABILITIES: Record<MediaPermission, MediaCapability[]> = {
  manage: ["media:view", "media:annotate", "media:manage", "media:complete_own_annotations", "media:complete_any_annotation"],
  annotate: ["media:view", "media:annotate", "media:complete_own_annotations", "media:complete_any_annotation"],
  view: ["media:view"]
};

export function capabilitiesForRole(role: ProjectRole) {
  return capabilitiesForProjectPermissions(ROLE_PROJECT_PERMISSIONS[role]);
}

export function capabilitiesForProjectPermissions(permissions: ProjectPermission[]) {
  return unique(permissions.flatMap((permission) => PROJECT_PERMISSION_CAPABILITIES[permission]));
}

export function capabilitiesForMediaPermissions(permissions: MediaPermission[]) {
  return unique(permissions.flatMap((permission) => MEDIA_PERMISSION_CAPABILITIES[permission]));
}

export function hasCapability(access: ProjectAccess | null | undefined, capability: ProjectCapability) {
  return !!access?.capabilities.includes(capability);
}

export function hasMediaCapability(access: MediaAccess | null | undefined, capability: MediaCapability) {
  return !!access?.capabilities.includes(capability);
}

export function strongerRole(a: ProjectRole, b: ProjectRole) {
  return ROLE_RANK[a] >= ROLE_RANK[b] ? a : b;
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}

function strongestProjectPermission(permissions: ProjectPermission[]): ProjectPermission | null {
  return permissions.reduce<ProjectPermission | null>((best, permission) => {
    if (!best) return permission;
    return PROJECT_PERMISSION_RANK[permission] > PROJECT_PERMISSION_RANK[best] ? permission : best;
  }, null);
}

function strongestMediaPermission(permissions: MediaPermission[]): MediaPermission | null {
  return permissions.reduce<MediaPermission | null>((best, permission) => {
    if (!best) return permission;
    return MEDIA_PERMISSION_RANK[permission] > MEDIA_PERMISSION_RANK[best] ? permission : best;
  }, null);
}

function roleForProjectPermissions(permissions: ProjectPermission[]): ProjectRole {
  const strongest = strongestProjectPermission(permissions);
  if (strongest === "manage") return "owner";
  if (strongest === "upload") return "editor";
  return "viewer";
}

function projectGrantMatches(grant: { subjectType: string; subjectUserId: string | null }, args: { userId: string; organizationId: string | null; isOrganizationMember: boolean }) {
  if (grant.subjectType === "creator") return false;
  if (grant.subjectType === "organization") return args.isOrganizationMember && !!args.organizationId;
  if (grant.subjectType === "invited_user") return grant.subjectUserId === args.userId;
  return false;
}

function mediaGrantMatches(grant: { subjectType: string; subjectUserId: string | null }, args: { userId: string; organizationId: string | null; isOrganizationMember: boolean }) {
  if (grant.subjectType === "creator") return false;
  if (grant.subjectType === "organization") return args.isOrganizationMember && !!args.organizationId;
  if (grant.subjectType === "invited_user") return grant.subjectUserId === args.userId;
  return false;
}

export function projectPermissionsToMediaPermissions(permissions: ProjectPermission[]): MediaPermission[] {
  const next = new Set<MediaPermission>();
  if (permissions.includes("view")) next.add("view");
  if (permissions.includes("upload")) next.add("annotate");
  if (permissions.includes("manage")) next.add("manage");
  return [...next];
}

export async function getProjectAccess(args: { userId: string; projectId: string }): Promise<ProjectAccess | null> {
  const [project, actor] = await Promise.all([
    prisma.project.findFirst({
      where: { id: args.projectId, deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        organizationId: true,
        members: {
          where: { userId: args.userId },
          select: { role: true },
          take: 1
        },
        permissionGrants: {
          select: { subjectType: true, subjectUserId: true, permission: true }
        }
      }
    }),
    prisma.user.findFirst({
      where: { id: args.userId, deletedAt: null, disabledAt: null },
      select: { globalRole: true }
    })
  ]);

  if (!project) return null;
  if (actor?.globalRole === "admin") {
    const permissions: ProjectPermission[] = ["manage", "upload", "view"];
    return {
      projectId: project.id,
      role: "owner",
      permissions,
      accessSource: "admin",
      capabilities: capabilitiesForProjectPermissions(permissions)
    };
  }
  if (project.ownerId === args.userId) {
    const permissions: ProjectPermission[] = ["manage", "upload", "view"];
    return {
      projectId: project.id,
      role: "owner",
      permissions,
      accessSource: "owner",
      capabilities: capabilitiesForProjectPermissions(permissions)
    };
  }

  const isOrganizationMember = project.organizationId
    ? Boolean(await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: project.organizationId, userId: args.userId } }, select: { userId: true } }))
    : false;

  const permissions = project.permissionGrants
    .filter((grant) => projectGrantMatches(grant, { userId: args.userId, organizationId: project.organizationId, isOrganizationMember }))
    .map((grant) => grant.permission as ProjectPermission);

  if (permissions.length > 0) {
    const deduped = unique(permissions);
    return {
      projectId: project.id,
      role: roleForProjectPermissions(deduped),
      permissions: deduped,
      accessSource: "project_grant",
      capabilities: capabilitiesForProjectPermissions(deduped)
    };
  }

  const legacyRole = project.members[0]?.role as ProjectRole | undefined;
  if (!legacyRole) return null;
  const legacyPermissions = ROLE_PROJECT_PERMISSIONS[legacyRole];
  return {
    projectId: project.id,
    role: legacyRole,
    permissions: legacyPermissions,
    accessSource: "legacy_member",
    capabilities: capabilitiesForProjectPermissions(legacyPermissions)
  };
}

export async function getMediaAccess(args: { userId: string; mediaId: string; includeDeleted?: boolean }): Promise<{ media: { id: string; projectId: string; deletedAt: Date | null; creatorId: string | null }; access: MediaAccess } | null> {
  const media = await prisma.media.findFirst({
    where: {
      id: args.mediaId,
      ...(args.includeDeleted ? {} : { deletedAt: null }),
      project: { deletedAt: null }
    },
    select: {
      id: true,
      projectId: true,
      creatorId: true,
      deletedAt: true,
      project: { select: { organizationId: true } },
      permissionGrants: { select: { subjectType: true, subjectUserId: true, permission: true } }
    }
  });
  if (!media) return null;

  const projectAccess = await getProjectAccess({ userId: args.userId, projectId: media.projectId });
  if (!projectAccess) return null;

  const isOrganizationMember = media.project.organizationId
    ? Boolean(await prisma.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: media.project.organizationId, userId: args.userId } }, select: { userId: true } }))
    : false;

  const inherited = projectPermissionsToMediaPermissions(projectAccess.permissions);
  const explicit = media.creatorId === args.userId
    ? ["manage" as MediaPermission]
    : media.permissionGrants
      .filter((grant) => mediaGrantMatches(grant, { userId: args.userId, organizationId: media.project.organizationId, isOrganizationMember }))
      .map((grant) => grant.permission as MediaPermission);
  const permissions = unique([...inherited, ...explicit]);
  if (permissions.length === 0) return null;

  return {
    media: { id: media.id, projectId: media.projectId, deletedAt: media.deletedAt, creatorId: media.creatorId },
    access: {
      mediaId: media.id,
      projectId: media.projectId,
      permissions,
      capabilities: capabilitiesForMediaPermissions(permissions),
      projectAccess
    }
  };
}

export async function getMediaProjectAccess(args: { userId: string; mediaId: string; includeDeleted?: boolean }) {
  const result = await getMediaAccess(args);
  if (!result) return null;
  return { media: result.media, access: result.access.projectAccess, mediaAccess: result.access };
}

export async function getAnnotationAccess(args: { userId: string; annotationId: string }) {
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
  const result = await getMediaAccess({ userId: args.userId, mediaId: annotation.mediaId });
  if (!result) return null;
  return { annotation, mediaAccess: result.access, projectAccess: result.access.projectAccess };
}

export async function getAnnotationProjectAccess(args: { userId: string; annotationId: string }) {
  const result = await getAnnotationAccess(args);
  if (!result) return null;
  return { annotation: result.annotation, access: result.projectAccess, mediaAccess: result.mediaAccess };
}

export function denyMissingAccess(reply: FastifyReply) {
  return reply.code(404).send({ error: "not_found" });
}

export function denyMissingCapability(reply: FastifyReply) {
  return reply.code(403).send({ error: "forbidden" });
}
