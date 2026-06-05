import type { FastifyRequest } from "fastify";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { putObjectStream } from "./s3";

function isReadable(value: unknown): value is Readable {
  return value instanceof Readable;
}

function isUploadAbortError(error: unknown) {
  const err = error as { code?: string; message?: string; name?: string };
  return (
    err?.code === "ECONNRESET" ||
    err?.code === "ERR_STREAM_PREMATURE_CLOSE" ||
    err?.name === "AbortError" ||
    err?.message === "aborted" ||
    err?.message?.includes("aborted") ||
    err?.message?.includes("premature close")
  );
}

function uploadAbortedError(cause: unknown) {
  const error = new Error("upload_aborted") as Error & { code: string; statusCode: number; cause: unknown };
  error.code = "upload_aborted";
  error.statusCode = 499;
  error.cause = cause;
  return error;
}

export async function putRequestBodyObject(args: {
  req: FastifyRequest;
  bucket: string;
  objectKey: string;
  contentType?: string | string[];
}) {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "markreel-upload-"));
  const tempFile = path.join(tempDir, "body");
  const source = isReadable(args.req.body) ? args.req.body : args.req.raw;

  try {
    await pipeline(source, fs.createWriteStream(tempFile));
    const stat = await fs.promises.stat(tempFile);

    await putObjectStream({
      bucket: args.bucket,
      objectKey: args.objectKey,
      body: fs.createReadStream(tempFile),
      contentType: Array.isArray(args.contentType) ? args.contentType[0] : args.contentType,
      contentLength: stat.size
    });
  } catch (error) {
    if (isUploadAbortError(error)) throw uploadAbortedError(error);
    throw error;
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  }
}
