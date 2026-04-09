import { randomUUID } from "node:crypto";
import type { Store, StoreProject, StoreUser } from "./types";

const usersById = new Map<string, StoreUser>();
const usersByUsername = new Map<string, string>();
const projectsById = new Map<string, StoreProject>();
const membershipsByUserId = new Map<string, Set<string>>();

function now() {
  return new Date();
}

function ensureMembership(userId: string, projectId: string) {
  let set = membershipsByUserId.get(userId);
  if (!set) {
    set = new Set<string>();
    membershipsByUserId.set(userId, set);
  }
  set.add(projectId);
}

export function createInMemoryStore(): Store {
  return {
    kind: "inmemory",

    async userFindByUsername(username) {
      const id = usersByUsername.get(username.toLowerCase());
      if (!id) return null;
      return usersById.get(id) ?? null;
    },

    async userFindById(id) {
      const user = usersById.get(id);
      if (!user) return null;
      return {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        createdAt: user.createdAt
      };
    },

    async userCreateOrRevive(args) {
      const normalized = args.username.toLowerCase();
      const existingId = usersByUsername.get(normalized);
      if (existingId) {
        const existing = usersById.get(existingId)!;
        existing.passwordHash = args.passwordHash;
        existing.displayName = args.displayName;
        return {
          id: existing.id,
          username: existing.username,
          displayName: existing.displayName,
          createdAt: existing.createdAt
        };
      }

      const id = randomUUID();
      const u: StoreUser = {
        id,
        username: normalized,
        passwordHash: args.passwordHash,
        displayName: args.displayName,
        createdAt: now()
      };
      usersById.set(id, u);
      usersByUsername.set(normalized, id);
      return {
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        createdAt: u.createdAt
      };
    },

    async projectListForUser(userId) {
      const ids = membershipsByUserId.get(userId);
      if (!ids) return [];
      return Array.from(ids)
        .map((id) => projectsById.get(id))
        .filter((p): p is StoreProject => Boolean(p))
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
      return projectsById.get(projectId) ?? null;
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
