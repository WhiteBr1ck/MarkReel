import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { getUserId, requireUser } from "../auth/requireUser";
import { auditLog } from "../audit";
import { newShareToken, sha256Hex } from "../share";

const SharePermissionSchema = z.enum(["view", "comment", "annotate"]);

const CreateShareSchema = z.object({
  permissions: z.array(SharePermissionSchema).min(1),
  expiresAt: z.string().datetime().optional()
});

function serializeShareLinkPermissions(
  permissions: Array<{ permission: z.infer<typeof SharePermissionSchema> }>
) {
  return permissions.map(({ permission }) => permission);
}

export async function shareLinkRoutes(app: FastifyInstance) {
  app.post(
    "/projects/:projectId/share-links",
    { preHandler: requireUser },
    async (req, reply) => {
      const userId = getUserId(req);
      const projectId = (req.params as any).projectId as string;
      const input = CreateShareSchema.parse(req.body);

      const project = await prisma.project.findFirst({
        where: {
          id: projectId,
          deletedAt: null,
          OR: [{ ownerId: userId }, { members: { some: { userId } } }]
        },
        select: { id: true }
      });
      if (!project) return reply.code(404).send({ error: "not_found" });

      const token = newShareToken();
      const tokenHash = sha256Hex(token);

      const link = await prisma.shareLink.create({
        data: {
          tokenHash,
          projectId,
          createdById: userId,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          permissions: {
            create: input.permissions.map((permission) => ({ permission }))
          }
        },
        select: {
          id: true,
          createdAt: true,
          expiresAt: true,
          permissions: { select: { permission: true } }
        }
      });

      await auditLog({
        req,
        actorUserId: userId,
        action: "share_link.create",
        entityType: "ShareLink",
        entityId: link.id,
        meta: { projectId, permissions: input.permissions }
      });

      return reply.code(201).send({
        shareLink: {
          ...link,
          permissions: serializeShareLinkPermissions(link.permissions),
          token,
          url: `/api/share/${token}`
        }
      });
    }
  );

  // Minimal introspection endpoint for guests.
  app.get("/share/:token", async (req, reply) => {
    const token = (req.params as any).token as string;
    const tokenHash = sha256Hex(token);
    const link = await prisma.shareLink.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        permissions: { select: { permission: true } },
        projectId: true,
        mediaId: true,
        expiresAt: true,
        revokedAt: true
      }
    });
    if (!link) return reply.code(404).send({ error: "not_found" });
    if (link.revokedAt) return reply.code(410).send({ error: "revoked" });
    if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return reply.code(410).send({ error: "expired" });
    return reply.send({
      share: {
        ...link,
        permissions: serializeShareLinkPermissions(link.permissions)
      }
    });
  });
}
