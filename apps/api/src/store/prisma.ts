import type { Store } from "./types";
import { prisma } from "../db";

export function createPrismaStore(): Store {
  return {
    kind: "db",

    async userFindByUsername(username) {
      const normalized = username.toLowerCase();
      const u = await prisma.user.findUnique({ where: { username: normalized } });
      if (!u || u.deletedAt) return null;
      return {
        id: u.id,
        username: u.username,
        passwordHash: u.passwordHash,
        displayName: u.displayName,
        createdAt: u.createdAt
      };
    },

    async userFindById(id) {
      const u = await prisma.user.findUnique({
        where: { id },
        select: { id: true, username: true, displayName: true, createdAt: true, deletedAt: true }
      });
      if (!u || u.deletedAt) return null;
      return { id: u.id, username: u.username, displayName: u.displayName, createdAt: u.createdAt };
    },

    async userCreateOrRevive(args) {
      const normalized = args.username.toLowerCase();
      const user = await prisma.user.upsert({
        where: { username: normalized },
        create: {
          username: normalized,
          passwordHash: args.passwordHash,
          displayName: args.displayName
        },
        update: {
          passwordHash: args.passwordHash,
          displayName: args.displayName,
          deletedAt: null
        },
        select: { id: true, username: true, displayName: true, createdAt: true }
      });
      return user;
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
