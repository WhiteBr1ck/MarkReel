import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { MarkReelClient } from "./client.js";

const videoTypes: Record<string, string> = {
  mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm",
  mkv: "video/x-matroska", avi: "video/x-msvideo", mts: "video/mp2t", m2ts: "video/mp2t",
  ts: "video/mp2t", wmv: "video/x-ms-wmv", flv: "video/x-flv", mpeg: "video/mpeg",
  mpg: "video/mpeg", "3gp": "video/3gpp", "3g2": "video/3gpp2"
};

export function videoContentType(filename: string) {
  return videoTypes[path.extname(filename).slice(1).toLowerCase()];
}

export class UploadError extends Error {
  constructor(message: string, readonly recovery: { mediaId: string; objectKey?: string; stage: string }) {
    super(message);
  }
}

export type VideoUploadInput = {
  projectId: string;
  filePath: string;
  title?: string;
  folderId?: string | null;
  sourceMediaId?: string;
  mode: "original" | "compress";
};

export async function uploadVideo(client: MarkReelClient, input: VideoUploadInput, signal: AbortSignal, onProgress?: (bytes: number, total: number) => void) {
  if (client.config.readOnly) throw new Error("MCP is configured as read-only");
  const filename = path.basename(input.filePath);
  const contentType = videoContentType(filename);
  if (!contentType) throw new Error("Unsupported video format");
  if (!path.isAbsolute(input.filePath)) throw new Error("filePath must be an absolute path on the MCP host");
  const filePath = await realpath(input.filePath);
  if (client.config.uploadRoots.length > 0) {
    const roots = await Promise.all(client.config.uploadRoots.map((root) => realpath(root)));
    const allowed = roots.some((root) => {
      const relative = path.relative(root, filePath);
      return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
    });
    if (!allowed) throw new Error("Video is outside MARKREEL_MCP_UPLOAD_ROOTS");
  }
  const file = await open(filePath, "r");
  let mediaId: string | undefined;
  let objectKey: string | undefined;
  let stage = "create";
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 || !Number.isSafeInteger(stat.size)) throw new Error("Video must be a nonempty regular file");
    const created = await client.request<{ media: { id: string; title: string } }>(`/projects/${encodeURIComponent(input.projectId)}/media`, {
      method: "POST", body: { title: input.title ?? path.basename(filename, path.extname(filename)).slice(0, 200), folderId: input.folderId, sourceMediaId: input.sourceMediaId }, signal
    });
    mediaId = created.media.id;
    stage = "presign";
    const presigned = await client.request<{ upload: { url: string; objectKey: string } }>(`/media/${encodeURIComponent(mediaId)}/upload/presign`, {
      method: "POST", body: { filename, contentType, mode: input.mode }, signal
    });
    objectKey = presigned.upload.objectKey;
    stage = "transfer";
    const streams: Readable[] = [];
    const createBody = () => {
      const source = file.createReadStream({ start: 0, end: stat.size - 1, autoClose: false });
      streams.push(source);
      const body = Readable.from((async function* () {
        let uploaded = 0;
        for await (const chunk of source) {
          signal.throwIfAborted();
          uploaded += (chunk as Buffer).byteLength;
          onProgress?.(uploaded, stat.size);
          yield chunk;
        }
      })());
      streams.push(body);
      return Readable.toWeb(body) as ReadableStream<Uint8Array>;
    };
    let transfer: "direct" | "api";
    try {
      transfer = await client.uploadFile(`/media/${encodeURIComponent(mediaId)}/upload/file?objectKey=${encodeURIComponent(objectKey)}`,
        createBody, stat.size, contentType, signal, presigned.upload.url);
    } finally {
      for (const stream of streams) stream.destroy();
    }
    stage = "process";
    const processing = await client.request(`/media/${encodeURIComponent(mediaId)}/process`, {
      method: "POST", body: { originalObjectKey: objectKey, mode: input.mode }, signal,
      timeoutMs: client.config.transferTimeoutMs
    });
    return { mediaId, title: created.media.title, objectKey, sizeBytes: stat.size, transfer, processing };
  } catch (error) {
    if (mediaId) throw new UploadError(error instanceof Error ? error.message : "Upload failed", { mediaId, objectKey, stage });
    throw error;
  } finally {
    await file.close();
  }
}
