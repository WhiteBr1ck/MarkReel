import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { getObjectStream } from "./s3";
import { ANNOTATION_EXPORT_LIMITS as limits, AnnotationExportError, assertNotCancelled } from "./annotationExport";

const execFileAsync = promisify(execFile);
export const ANNOTATION_FRAME_WIDTH = 640;
export const ANNOTATION_FRAME_HEIGHT = 360;

export function annotationMediaFrameKey(mediaId: string, file: { id: string; originalObjectKey: string; createdAt: Date }, timestampMs: number) {
  return exportFrameKey(`${mediaId}:${file.id}:${file.originalObjectKey}:${file.createdAt.toISOString()}`, timestampMs);
}

export async function copyExportObject(target: { bucket: string; objectKey: string }, destination: string, maxBytes: number, signal: AbortSignal) {
  assertNotCancelled(signal);
  const timeout = AbortSignal.timeout(60000);
  const combined = AbortSignal.any([signal, timeout]);
  const object = await getObjectStream({ ...target, abortSignal: combined });
  if (!object.body) throw new AnnotationExportError("attachment_unavailable");
  if (object.contentLength !== undefined && object.contentLength > maxBytes) {
    object.body.destroy();
    throw new AnnotationExportError("resource_limit", 413);
  }
  let bytes = 0;
  const cap = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > maxBytes ? new AnnotationExportError("resource_limit", 413) : null, chunk);
  } });
  try {
    await pipeline(object.body, cap, createWriteStream(destination, { flags: "wx" }), { signal: combined });
    return bytes;
  } catch (error) {
    await rm(destination, { force: true });
    assertNotCancelled(signal);
    throw error;
  }
}

type FrameEntry = { bytes: Buffer; expiresAt: number };
const frameCache = new Map<string, FrameEntry>();
let cacheBytes = 0;
let activeFrames = 0;
const frameWaiters: Array<() => void> = [];

async function frameSlot(signal: AbortSignal) {
  while (activeFrames >= limits.frameConcurrency) {
    await new Promise<void>((resolve, reject) => {
      const wake = () => { signal.removeEventListener("abort", abort); resolve(); };
      const abort = () => {
        const index = frameWaiters.indexOf(wake);
        if (index >= 0) frameWaiters.splice(index, 1);
        reject(new AnnotationExportError("export_cancelled", 409));
      };
      frameWaiters.push(wake);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  assertNotCancelled(signal);
  activeFrames += 1;
}

function sweepFrames() {
  for (const [key, entry] of frameCache) {
    if (entry.expiresAt <= Date.now() || cacheBytes > limits.frameCacheBytes) {
      cacheBytes -= entry.bytes.length;
      frameCache.delete(key);
    }
  }
}
const cacheSweep = setInterval(sweepFrames, 30000);
cacheSweep.unref();

export function exportFrameKey(fileIdentity: string, timestampMs: number) {
  return createHash("sha256").update(`${fileIdentity}:${timestampMs}:640x360-v1`).digest("hex");
}

export function cachedExportFrame(key: string) {
  sweepFrames();
  return frameCache.get(key)?.bytes;
}

export async function extractExportFrame(source: string, timestampMs: number, key: string, signal: AbortSignal, remote = false) {
  const cached = cachedExportFrame(key);
  if (cached) return cached;
  await frameSlot(signal);
  try {
    const existing = cachedExportFrame(key);
    if (existing) return existing;
    const result = await execFileAsync("ffmpeg", [
      "-nostdin", "-v", "error", "-max_alloc", "67108864", "-threads", "1",
      "-protocol_whitelist", remote ? "http,https,tcp,tls,crypto,pipe" : "file,pipe",
      "-format_whitelist", "mov,matroska,webm,avi,mpegts,mpegvideo,png_pipe,jpeg_pipe,gif,bmp_pipe,webp_pipe",
      ...(remote ? ["-rw_timeout", "10000000"] : []),
      "-ss", (Math.max(0, timestampMs) / 1000).toFixed(3), "-i", source,
      "-frames:v", "1", "-an", "-vf", `scale=${ANNOTATION_FRAME_WIDTH}:${ANNOTATION_FRAME_HEIGHT}:force_original_aspect_ratio=decrease,pad=${ANNOTATION_FRAME_WIDTH}:${ANNOTATION_FRAME_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=white`, "-threads", "1",
      "-f", "image2pipe", "-c:v", "mjpeg", "-q:v", "4", "pipe:1"
    ], { signal, timeout: 30000, windowsHide: true, encoding: "buffer", maxBuffer: 2 * 1024 * 1024 });
    assertNotCancelled(signal);
    if (!result.stdout.length) throw new AnnotationExportError("frame_unavailable");
    const bytes = result.stdout;
    frameCache.set(key, { bytes, expiresAt: Date.now() + limits.frameCacheTtlMs });
    cacheBytes += bytes.length;
    sweepFrames();
    return bytes;
  } catch (error) {
    assertNotCancelled(signal);
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AnnotationExportError("ffmpeg_unavailable", 503);
    throw new AnnotationExportError("frame_unavailable");
  } finally {
    activeFrames -= 1;
    frameWaiters.shift()?.();
  }
}

export async function checkExportOutput(path: string) {
  const size = (await stat(path)).size;
  if (size > limits.outputBytes) throw new AnnotationExportError("resource_limit", 413);
  return size;
}
