import type { FastifyReply } from "fastify";
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

  if (args.range && objectMeta.sizeBytes) {
    const parsedRange = parseByteRange(
      args.range,
      objectMeta.sizeBytes,
      args.kind === "video" ? VIDEO_RANGE_CHUNK_BYTES : undefined
    );
    if (!parsedRange) return args.reply.code(416).send();

    const rangedObject = await getObjectStream({
      ...args.target,
      range: `bytes=${parsedRange.start}-${parsedRange.end}`
    });
    if (!rangedObject.body) return args.reply.code(404).send({ error: notFoundError });

    args.reply.code(206);
    args.reply.header("content-range", `bytes ${parsedRange.start}-${parsedRange.end}/${objectMeta.sizeBytes}`);
    args.reply.header("content-length", String(parsedRange.end - parsedRange.start + 1));
    args.reply.header("content-type", resolveContentType({ kind: args.kind, objectKey: args.target.objectKey, contentType: rangedObject.contentType ?? contentType }));
    args.reply.header("accept-ranges", "bytes");
    if (objectMeta.etag) args.reply.header("etag", objectMeta.etag);
    if (objectMeta.lastModified) args.reply.header("last-modified", objectMeta.lastModified.toUTCString());
    return args.reply.send(rangedObject.body);
  }

  const object = await getObjectStream(args.target);
  if (!object.body) return args.reply.code(404).send({ error: notFoundError });

  args.reply.header("content-type", resolveContentType({ kind: args.kind, objectKey: args.target.objectKey, contentType: object.contentType ?? contentType }));
  if (objectMeta.sizeBytes) args.reply.header("content-length", String(objectMeta.sizeBytes));
  if (objectMeta.etag) args.reply.header("etag", objectMeta.etag);
  if (objectMeta.lastModified) args.reply.header("last-modified", objectMeta.lastModified.toUTCString());
  args.reply.header("accept-ranges", "bytes");

  return args.reply.send(object.body);
}

