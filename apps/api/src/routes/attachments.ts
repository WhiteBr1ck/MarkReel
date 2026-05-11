import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { env } from "../env";
import { presignPutObject } from "../s3";
import { getUserId, requireUser } from "../auth/requireUser";
import { auditLog } from "../audit";

const PresignAttachmentSchema = z.object({
  filename: z.string().min(1).max(260),
  contentType: z.string().min(1).max(120)
});

export async function attachmentRoutes(app: FastifyInstance) {
  app.post("/attachments/presign", { preHandler: requireUser }, async (req, reply) => {
    const userId = getUserId(req);
    const input = PresignAttachmentSchema.parse(req.body);
    const ext = input.filename.includes(".")
      ? input.filename.split(".").pop()!.slice(0, 10)
      : "bin";
    const objectKey = input.filename.startsWith("markup-")
      ? `attachments/markup/${nanoid(18)}.${ext}`
      : `attachments/${nanoid(18)}.${ext}`;
    const url = await presignPutObject({
      bucket: env.S3_BUCKET_ATTACHMENTS,
      objectKey,
      contentType: input.contentType
    });

    await auditLog({
      req,
      actorUserId: userId,
      action: "attachment.presign",
      entityType: "Attachment",
      entityId: objectKey,
      meta: { contentType: input.contentType }
    });

    return reply.send({
      upload: {
        method: "PUT",
        url,
        objectKey,
        bucket: env.S3_BUCKET_ATTACHMENTS
      }
    });
  });
}
