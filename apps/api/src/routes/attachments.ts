import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { nanoid } from "nanoid";
import { env } from "../env";
import { presignPutObject } from "../s3";
import { putRequestBodyObject } from "../uploadProxy";
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
      contentType: input.contentType,
      req
    });
    const proxyUrl = `/api/attachments/upload/file?objectKey=${encodeURIComponent(objectKey)}`;

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
        proxyUrl,
        objectKey,
        bucket: env.S3_BUCKET_ATTACHMENTS
      }
    });
  });

  app.put("/attachments/upload/file", { preHandler: requireUser }, async (req, reply) => {
    const objectKey = String((req.query as any).objectKey ?? "");
    if (!objectKey.startsWith("attachments/")) {
      return reply.code(400).send({ error: "invalid_object_key" });
    }

    await putRequestBodyObject({
      req,
      bucket: env.S3_BUCKET_ATTACHMENTS,
      objectKey,
      contentType: req.headers["content-type"] ?? undefined
    });

    return reply.send({ ok: true, objectKey });
  });
}
