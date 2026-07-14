import type { FastifyReply } from "fastify";
import type { Readable } from "node:stream";
import { getObjectStream, statObject } from "./s3";

type ObjectTarget = { bucket: string; objectKey: string };
type ObjectResponseKind = "attachment" | "video";

type ByteRange = {
  start: number;
  end: number;
};

export const VIDEO_RANGE_CHUNK_BYTES = 64 * 1024 * 1024;

const videoContentTypesByExtension: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska"
};

function objectExtension(objectKey: string) {
  const cleanKey = objectKey.split("?")[0] ?? objectKey;
  const lastSegment = cleanKey.split("/").pop() ?? cleanKey;
  const dotIndex = lastSegment.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === lastSegment.length - 1) return "";
  return lastSegment.slice(dotIndex + 1).toLowerCase();
}

function resolveContentType(args: { kind: ObjectResponseKind; objectKey: string; contentType?: string }) {
  if (args.contentType && args.contentType !== "application/octet-stream") return args.contentType;
  if (args.kind !== "video") return args.contentType ?? "application/octet-stream";
  return videoContentTypesByExtension[objectExtension(args.objectKey)] ?? args.contentType ?? "application/octet-stream";
}

export function parseByteRange(range: string, total: number, maxOpenEndedBytes?: number): ByteRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) return null;

  const startRaw = match[1] ?? "";
  const endRaw = match[2] ?? "";
  if (!startRaw && !endRaw) return null;

  if (!startRaw) {
    const suffixLength = Number(endRaw);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(total - suffixLength, 0),
      end: total - 1
    };
  }

  const start = Number(startRaw);
  const requestedEnd = endRaw
    ? Number(endRaw)
    : maxOpenEndedBytes
      ? Math.min(start + maxOpenEndedBytes - 1, total - 1)
      : total - 1;
  if (!Number.isFinite(start) || !Number.isFinite(requestedEnd)) return null;
  if (start < 0 || requestedEnd < 0 || start > requestedEnd || start >= total) return null;

  return {
    start,
    end: Math.min(requestedEnd, total - 1)
  };
}

export async function sendObjectResponse(args: {
  reply: FastifyReply;
  target: ObjectTarget;
  kind: ObjectResponseKind;
  range?: string;
  notFoundError?: string;
}) {
  const notFoundError = args.notFoundError ?? "not_found";
  const objectMeta = await statObject(args.target).catch(() => null);
  if (!objectMeta) return args.reply.code(404).send({ error: notFoundError });
  const contentType = resolveContentType({
    kind: args.kind,
    objectKey: args.target.objectKey,
    contentType: objectMeta.contentType
  });
  const abortController = new AbortController();
  let clientClosed = false;
  let streamSettled = false;
  const streamStartedAt = Date.now();
  const logContext = {
    bucket: args.target.bucket,
    objectKey: args.target.objectKey,
    requestedRange: args.range,
    kind: args.kind
  };
  const onClientClose = () => {
    if (args.reply.raw.writableEnded) return;
    clientClosed = true;
    abortController.abort();
  };
  const releaseClientCloseListener = () => {
    args.reply.raw.off("close", onClientClose);
  };
  const finishStream = (outcome: "completed" | "client_closed" | "stream_closed" | "error", error?: unknown) => {
    if (streamSettled) return;
    streamSettled = true;
    releaseClientCloseListener();
    const details = { ...logContext, outcome, durationMs: Date.now() - streamStartedAt };
    if (outcome === "completed") {
      args.reply.request.log.debug(details, "object stream completed");
    } else if (outcome === "client_closed") {
      args.reply.request.log.debug(details, "object stream cancelled after client disconnect");
    } else {
      args.reply.request.log.warn({ ...details, err: error }, "object stream ended unexpectedly");
    }
  };
  const sendStream = (body: Readable) => {
    body.once("end", () => finishStream("completed"));
    body.once("error", (error) => finishStream(clientClosed ? "client_closed" : "error", error));
    body.once("close", () => finishStream(clientClosed ? "client_closed" : "stream_closed"));
    args.reply.request.log.debug(logContext, "object stream started");
    return args.reply.send(body);
  };
  args.reply.raw.once("close", onClientClose);

  try {
    if (args.range && objectMeta.sizeBytes) {
      const parsedRange = parseByteRange(
        args.range,
        objectMeta.sizeBytes,
        args.kind === "video" ? VIDEO_RANGE_CHUNK_BYTES : undefined
      );
      if (!parsedRange) {
        releaseClientCloseListener();
        return args.reply.code(416).send();
      }

      const rangedObject = await getObjectStream({
        ...args.target,
        range: `bytes=${parsedRange.start}-${parsedRange.end}`,
        abortSignal: abortController.signal
      });
      if (!rangedObject.body) {
        releaseClientCloseListener();
        return args.reply.code(404).send({ error: notFoundError });
      }
      if (clientClosed) {
        rangedObject.body.destroy();
        finishStream("client_closed");
        return args.reply;
      }

      args.reply.code(206);
      args.reply.header("content-range", `bytes ${parsedRange.start}-${parsedRange.end}/${objectMeta.sizeBytes}`);
      args.reply.header("content-length", String(parsedRange.end - parsedRange.start + 1));
      args.reply.header("content-type", resolveContentType({ kind: args.kind, objectKey: args.target.objectKey, contentType: rangedObject.contentType ?? contentType }));
      args.reply.header("accept-ranges", "bytes");
      if (objectMeta.etag) args.reply.header("etag", objectMeta.etag);
      if (objectMeta.lastModified) args.reply.header("last-modified", objectMeta.lastModified.toUTCString());
      return sendStream(rangedObject.body);
    }

    const object = await getObjectStream({ ...args.target, abortSignal: abortController.signal });
    if (!object.body) {
      releaseClientCloseListener();
      return args.reply.code(404).send({ error: notFoundError });
    }
    if (clientClosed) {
      object.body.destroy();
      finishStream("client_closed");
      return args.reply;
    }

    args.reply.header("content-type", resolveContentType({ kind: args.kind, objectKey: args.target.objectKey, contentType: object.contentType ?? contentType }));
    if (objectMeta.sizeBytes) args.reply.header("content-length", String(objectMeta.sizeBytes));
    if (objectMeta.etag) args.reply.header("etag", objectMeta.etag);
    if (objectMeta.lastModified) args.reply.header("last-modified", objectMeta.lastModified.toUTCString());
    args.reply.header("accept-ranges", "bytes");

    return sendStream(object.body);
  } catch (error) {
    releaseClientCloseListener();
    if (clientClosed) {
      finishStream("client_closed", error);
      return args.reply;
    }
    args.reply.request.log.warn({ ...logContext, err: error, durationMs: Date.now() - streamStartedAt }, "object stream could not be opened");
    throw error;
  }
}

