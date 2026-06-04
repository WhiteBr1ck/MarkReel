import type { FastifyInstance } from "fastify";
import { env } from "../env";
import { getObjectStream, putObjectStream } from "../s3";
import { requireUser } from "../auth/requireUser";

function bucketAllowed(bucket: string) {
  return bucket === env.S3_BUCKET_ORIGINAL || bucket === env.S3_BUCKET_DERIVED || bucket === env.S3_BUCKET_ATTACHMENTS;
}

export async function objectRoutes(app: FastifyInstance) {
  app.get("/objects/:bucket/*", { preHandler: requireUser }, async (req, reply) => {
    const bucket = (req.params as any).bucket as string;
    const objectKey = (req.params as any)["*"] as string;
    if (!bucketAllowed(bucket) || !objectKey) return reply.code(404).send({ error: "not_found" });

    const object = await getObjectStream({
      bucket,
      objectKey,
      range: typeof req.headers.range === "string" ? req.headers.range : undefined
    });
    if (!object.body) return reply.code(404).send({ error: "not_found" });

    if (object.contentType) reply.header("content-type", object.contentType);
    if (object.contentLength != null) reply.header("content-length", object.contentLength);
    if (object.etag) reply.header("etag", object.etag);
    if (req.headers.range) reply.code(206);
    return reply.send(object.body);
  });

  app.put("/objects/:bucket/*", { preHandler: requireUser }, async (req, reply) => {
    const bucket = (req.params as any).bucket as string;
    const objectKey = (req.params as any)["*"] as string;
    if (!bucketAllowed(bucket) || !objectKey) return reply.code(404).send({ error: "not_found" });

    await putObjectStream({
      bucket,
      objectKey,
      body: req.raw,
      contentType: req.headers["content-type"] ?? undefined,
      contentLength: req.headers["content-length"] ? Number(req.headers["content-length"]) : undefined
    });

    return reply.send({ ok: true, objectKey });
  });
}
