import type { Store, StoreUser, StoreUserProfile } from "./types";
import { createRandomAvatarPreset } from "../avatarPresets";
import { prisma } from "../db";

function toStoreUser(u: {
  id: string;
  username: string;
  passwordHash: string;
  displayName: string | null;
  avatarObjectKey: string | null;
  avatarContentType: string | null;
  avatarPreset: string | null;
  globalRole: "admin" | "user";
  sessionVersion: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): StoreUser {
  return {
    id: u.id,
    username: u.username,
    passwordHash: u.passwordHash,
    displayName: u.displayName,
    avatarObjectKey: u.avatarObjectKey,
    avatarContentType: u.avatarContentType,
    avatarPreset: u.avatarPreset,
    globalRole: u.globalRole,
    sessionVersion: u.sessionVersion,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
    deletedAt: u.deletedAt
  };
}

function toStoreUserProfile(user: StoreUser): StoreUserProfile {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarObjectKey: user.avatarObjectKey,
    avatarContentType: user.avatarContentType,
    avatarPreset: user.avatarPreset,
    globalRole: user.globalRole,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

export function createPrismaStore(): Store {
  return {
    kind: "db",

    async userFindByUsername(username) {
      const normalized = username.toLowerCase();
      const u = await prisma.user.findUnique({ where: { username: normalized } });
      if (!u || u.deletedAt) return null;
      return toStoreUser(u);
    },

    async userFindById(id) {
      const u = await prisma.user.findUnique({ where: { id } });
      if (!u || u.deletedAt) return null;
      return toStoreUser(u);
    },

    async userCreateOrRevive(args) {
      const normalized = args.username.toLowerCase();
      const user = await prisma.user.upsert({
        where: { username: normalized },
        create: {
          username: normalized,
          passwordHash: args.passwordHash,
          displayName: args.displayName,
          avatarPreset: createRandomAvatarPreset(),
          globalRole: args.globalRole ?? "user"
        },
        update: {
          passwordHash: args.passwordHash,
          displayName: args.displayName,
          avatarObjectKey: null,
          avatarContentType: null,
          avatarPreset: createRandomAvatarPreset(),
          globalRole: args.globalRole ?? "user",
          sessionVersion: 1,
          deletedAt: null
        }
      });
      return toStoreUser(user);
    },

    async userEnsureAdmin(args) {
      const normalized = args.username.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { username: normalized } });
      if (existing) {
        const user = await prisma.user.update({
          where: { id: existing.id },
          data: {
            globalRole: "admin",
            deletedAt: null
          }
        });
        return toStoreUser(user);
      }

      const user = await prisma.user.create({
        data: {
          username: normalized,
          passwordHash: args.passwordHash,
          displayName: args.displayName,
          avatarPreset: createRandomAvatarPreset(),
          globalRole: "admin"
        }
      });
      return toStoreUser(user);
    },

    async userUpdateProfile(args) {
      const existing = await prisma.user.findUnique({ where: { id: args.userId } });
      if (!existing || existing.deletedAt) return null;
      const user = await prisma.user.update({
        where: { id: args.userId },
        data: {
          displayName: args.displayName,
          avatarObjectKey: args.avatarObjectKey,
          avatarContentType: args.avatarContentType,
          avatarPreset: args.avatarPreset
        }
      });
      return toStoreUser(user);
    },

    async userChangePassword(args) {
      const existing = await prisma.user.findUnique({ where: { id: args.userId } });
      if (!existing || existing.deletedAt) return null;
      const user = await prisma.user.update({
        where: { id: args.userId },
        data: {
          passwordHash: args.passwordHash,
          sessionVersion: args.nextSessionVersion
        }
      });
      return toStoreUser(user);
    },

    async userList() {
      const rows = await prisma.user.findMany({
        where: { deletedAt: null },
        orderBy: [{ createdAt: "asc" }]
      });
      return rows.map((row) => toStoreUserProfile(toStoreUser(row)));
    },

    async userCreateByAdmin(args) {
      const normalized = args.username.toLowerCase();
      const existing = await prisma.user.findUnique({ where: { username: normalized } });
      if (existing && !existing.deletedAt) {
        throw new Error("username_taken");
      }
      if (existing?.deletedAt) {
        const revived = await prisma.user.update({
          where: { id: existing.id },
          data: {
            username: normalized,
            passwordHash: args.passwordHash,
            displayName: args.displayName,
            avatarObjectKey: null,
            avatarContentType: null,
            avatarPreset: createRandomAvatarPreset(),
            globalRole: args.globalRole ?? "user",
            sessionVersion: 1,
            deletedAt: null
          }
        });
        return toStoreUser(revived);
      }
      const user = await prisma.user.create({
        data: {
          username: normalized,
          passwordHash: args.passwordHash,
          displayName: args.displayName,
          avatarPreset: createRandomAvatarPreset(),
          globalRole: args.globalRole ?? "user"
        }
      });
      return toStoreUser(user);
    },

    async adminUpdateUserProfile(args) {
      const existing = await prisma.user.findUnique({ where: { id: args.userId } });
      if (!existing || existing.deletedAt) return null;
      const user = await prisma.user.update({
        where: { id: args.userId },
        data: {
          displayName: args.displayName
        }
      });
      return toStoreUser(user);
    },

    async adminResetUserPassword(args) {
      const existing = await prisma.user.findUnique({ where: { id: args.userId } });
      if (!existing || existing.deletedAt) return null;
      const user = await prisma.user.update({
        where: { id: args.userId },
        data: {
          passwordHash: args.passwordHash,
          sessionVersion: args.nextSessionVersion
        }
      });
      return toStoreUser(user);
    },

    async userSoftDelete(args) {
      const existing = await prisma.user.findUnique({ where: { id: args.userId } });
      if (!existing || existing.deletedAt) return null;
      const user = await prisma.user.update({
        where: { id: args.userId },
        data: {
          deletedAt: new Date(),
          sessionVersion: existing.sessionVersion + 1
        }
      });
      return toStoreUser(user);
    },

    async projectListForUser(userId) {
      const rows = await prisma.project.findMany({
        where: {
          deletedAt: null,
          OR: [{ ownerId: userId }, { members: { some: { userId } } }]
        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, ownerId: true, createdAt: true, updatedAt: true }
      });
      return rows;
    },

    async projectCreate({ userId, name }) {
      const project = await prisma.project.create({
        data: {
          name,
          ownerId: userId,
          members: {
            create: {
              userId,
              role: "owner"
            }
          }
        },
        select: { id: true, name: true, ownerId: true, createdAt: true, updatedAt: true }
      });
      return project;
    },

    async projectGetForUser({ userId, projectId }) {
      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          deletedAt: null,
          OR: [{ ownerId: userId }, { members: { some: { userId } } }]
        },
        select: { id: true, name: true, ownerId: true, createdAt: true, updatedAt: true }
      });
      return project;
    },

    async projectRenameForUser({ userId, projectId, name }) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId, deletedAt: null },
        select: { id: true }
      });
      if (!project) return null;

      return prisma.project.update({
        where: { id: projectId },
        data: { name },
        select: { id: true, name: true, ownerId: true, createdAt: true, updatedAt: true }
      });
    },

    async projectDeleteForUser({ userId, projectId }) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, ownerId: userId, deletedAt: null },
        select: { id: true, name: true, ownerId: true, createdAt: true, updatedAt: true }
      });
      if (!project) return null;

      await prisma.project.update({
        where: { id: projectId },
        data: { deletedAt: new Date() }
      });

      return project;
    }
  };
}
