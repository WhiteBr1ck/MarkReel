import type { FastifyRequest } from "fastify";
import { Readable } from "node:stream";
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
  const source = isReadable(args.req.body) ? args.req.body : args.req.raw;

  try {
    await putObjectStream({
      bucket: args.bucket,
      objectKey: args.objectKey,
      body: source,
      contentType: Array.isArray(args.contentType) ? args.contentType[0] : args.contentType,
      contentLength: typeof args.req.headers["content-length"] === "string" ? Number(args.req.headers["content-length"]) : undefined
    });
  } catch (error) {
    if (isUploadAbortError(error)) throw uploadAbortedError(error);
    throw error;
  }
}
