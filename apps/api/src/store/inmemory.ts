import { randomUUID } from "node:crypto";
import { createRandomAvatarPreset } from "../avatarPresets";
import { capabilitiesForRole } from "../access";
import type { Store, StoreProject, StoreUser, StoreUserProfile } from "./types";

const usersById = new Map<string, StoreUser>();
const usersByUsername = new Map<string, string>();
const projectsById = new Map<string, StoreProject>();
const membershipsByUserId = new Map<string, Set<string>>();

function now() {
  return new Date();
}

function toProfile(user: StoreUser): StoreUserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarObjectKey: user.avatarObjectKey,
    avatarContentType: user.avatarContentType,
    avatarPreset: user.avatarPreset,
    globalRole: user.globalRole,
    lastLoginAt: user.lastLoginAt,
    disabledAt: user.disabledAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    deletedAt: user.deletedAt
  };
}

function ensureMembership(userId: string, projectId: string) {
  let set = membershipsByUserId.get(userId);
  if (!set) {
    set = new Set<string>();
    membershipsByUserId.set(userId, set);
  }
  set.add(projectId);
}

function withOwnerAccess(project: StoreProject): StoreProject {
  return {
    ...project,
    role: "owner",
    accessSource: "owner",
    capabilities: capabilitiesForRole("owner")
  };
}

export function createInMemoryStore(): Store {
  return {
    kind: "inmemory",

    async userFindByUsername(username) {
      const id = usersByUsername.get(username.toLowerCase());
      if (!id) return null;
      const user = usersById.get(id) ?? null;
      if (!user || user.deletedAt) return null;
      return user;
    },

    async userFindById(id) {
      const user = usersById.get(id) ?? null;
      if (!user || user.deletedAt) return null;
      return user;
    },

    async userCreateOrRevive(args) {
      const normalized = args.username.toLowerCase();
      const existingId = usersByUsername.get(normalized);
      if (existingId) {
        const existing = usersById.get(existingId)!;
        existing.passwordHash = args.passwordHash;
        existing.displayName = args.displayName;
        existing.avatarObjectKey = null;
        existing.avatarContentType = null;
        existing.avatarPreset = createRandomAvatarPreset();
        existing.globalRole = args.globalRole ?? "user";
        existing.sessionVersion = 1;
        existing.disabledAt = null;
        existing.updatedAt = now();
        existing.deletedAt = null;
        return existing;
      }

      const t = now();
      const u: StoreUser = {
        id: randomUUID(),
        username: normalized,
        passwordHash: args.passwordHash,
        displayName: args.displayName,
        avatarObjectKey: null,
        avatarContentType: null,
        avatarPreset: createRandomAvatarPreset(),
        globalRole: args.globalRole ?? "user",
        sessionVersion: 1,
        lastLoginAt: null,
        disabledAt: null,
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      };
      usersById.set(u.id, u);
      usersByUsername.set(normalized, u.id);
      return u;
    },

    async userEnsureAdmin(args) {
      const normalized = args.username.toLowerCase();
      const existingId = usersByUsername.get(normalized);
      if (existingId) {
        const existing = usersById.get(existingId)!;
        existing.globalRole = "admin";
        existing.disabledAt = null;
        existing.updatedAt = now();
        existing.deletedAt = null;
        return existing;
      }

      const t = now();
      const user: StoreUser = {
        id: randomUUID(),
        username: normalized,
        passwordHash: args.passwordHash,
        displayName: args.displayName,
        avatarObjectKey: null,
        avatarContentType: null,
        avatarPreset: createRandomAvatarPreset(),
        globalRole: "admin",
        sessionVersion: 1,
        lastLoginAt: null,
        disabledAt: null,
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      };
      usersById.set(user.id, user);
      usersByUsername.set(normalized, user.id);
      return user;
    },

    async userUpdateProfile(args) {
      const user = usersById.get(args.userId) ?? null;
      if (!user || user.deletedAt) return null;
      user.displayName = args.displayName;
      user.avatarObjectKey = args.avatarObjectKey;
      user.avatarContentType = args.avatarContentType;
      user.avatarPreset = args.avatarPreset;
      user.updatedAt = now();
      return user;
    },

    async userChangePassword(args) {
      const user = usersById.get(args.userId) ?? null;
      if (!user || user.deletedAt) return null;
      user.passwordHash = args.passwordHash;
      user.sessionVersion = args.nextSessionVersion;
      user.updatedAt = now();
      return user;
    },

    async userRecordLogin(args) {
      const user = usersById.get(args.userId) ?? null;
      if (!user || user.deletedAt) return null;
      user.lastLoginAt = now();
      user.updatedAt = now();
      return user;
    },

    async userList(args) {
      return Array.from(usersById.values())
        .filter((user) => args?.includeDeleted || !user.deletedAt)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((user) => toProfile(user));
    },

    async userCreateByAdmin(args) {
      const normalized = args.username.toLowerCase();
      const existingId = usersByUsername.get(normalized);
      if (existingId) {
        const existing = usersById.get(existingId)!;
        if (!existing.deletedAt) {
          throw new Error("username_taken");
        }
        existing.passwordHash = args.passwordHash;
        existing.displayName = args.displayName;
        existing.avatarObjectKey = null;
        existing.avatarContentType = null;
        existing.avatarPreset = createRandomAvatarPreset();
        existing.globalRole = args.globalRole ?? "user";
        existing.sessionVersion = 1;
        existing.disabledAt = null;
        existing.updatedAt = now();
        existing.deletedAt = null;
        return existing;
      }

      const t = now();
      const user: StoreUser = {
        id: randomUUID(),
        username: normalized,
        passwordHash: args.passwordHash,
        displayName: args.displayName,
        avatarObjectKey: null,
        avatarContentType: null,
        avatarPreset: createRandomAvatarPreset(),
        globalRole: args.globalRole ?? "user",
        sessionVersion: 1,
        lastLoginAt: null,
        disabledAt: null,
        createdAt: t,
        updatedAt: t,
        deletedAt: null
      };
      usersById.set(user.id, user);
      usersByUsername.set(normalized, user.id);
      return user;
    },

    async adminUpdateUserProfile(args) {
      const user = usersById.get(args.userId) ?? null;
      if (!user || user.deletedAt) return null;
      user.displayName = args.displayName;
      if (args.globalRole) user.globalRole = args.globalRole;
      user.updatedAt = now();
      return user;
    },

    async adminResetUserPassword(args) {
      const user = usersById.get(args.userId) ?? null;
      if (!user || user.deletedAt) return null;
      user.passwordHash = args.passwordHash;
      user.sessionVersion = args.nextSessionVersion;
      user.updatedAt = now();
      return user;
    },

    async userSoftDelete(args) {
      const user = usersById.get(args.userId) ?? null;
      if (!user || user.deletedAt) return null;
      user.deletedAt = now();
      user.sessionVersion += 1;
      user.updatedAt = now();
      return user;
    },

    async adminSetUserDisabled(args) {
      const user = usersById.get(args.userId) ?? null;
      if (!user || user.deletedAt) return null;
      user.disabledAt = args.disabled ? now() : null;
      user.sessionVersion += 1;
      user.updatedAt = now();
      return user;
    },

    async adminRestoreUser(args) {
      const user = usersById.get(args.userId) ?? null;
      if (!user || !user.deletedAt) return null;
      user.deletedAt = null;
      user.disabledAt = null;
      user.sessionVersion += 1;
      user.updatedAt = now();
      return user;
    },

    async projectListForUser(userId) {
      const ids = membershipsByUserId.get(userId);
      if (!ids) return [];
      return Array.from(ids)
        .map((id) => projectsById.get(id))
        .filter((p): p is StoreProject => Boolean(p))
        .map((project) => withOwnerAccess(project))
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    },

    async projectCreate({ userId, name }) {
      const t = now();
      const project: StoreProject = {
        id: randomUUID(),
        name,
        ownerId: userId,
        createdAt: t,
        updatedAt: t
      };
      projectsById.set(project.id, project);
      ensureMembership(userId, project.id);
      return project;
    },

    async projectGetForUser({ userId, projectId }) {
      const memberships = membershipsByUserId.get(userId);
      if (!memberships?.has(projectId)) return null;
      const project = projectsById.get(projectId) ?? null;
      return project ? withOwnerAccess(project) : null;
    },

    async projectRenameForUser({ userId, projectId, name }) {
      const project = projectsById.get(projectId);
      if (!project || project.ownerId !== userId) return null;
      project.name = name;
      project.updatedAt = now();
      return project;
    },

    async projectDeleteForUser({ userId, projectId }) {
      const project = projectsById.get(projectId);
      if (!project || project.ownerId !== userId) return null;
      projectsById.delete(projectId);
      for (const memberships of membershipsByUserId.values()) {
        memberships.delete(projectId);
      }
      return project;
    }
  };
}
