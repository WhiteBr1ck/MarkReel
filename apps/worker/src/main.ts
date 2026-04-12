import { Worker, type ConnectionOptions, type Job } from "bullmq";
import { PrismaClient } from "@prisma/client";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import IORedis from "ioredis";
import { execFile } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import { env } from "./env";

type MediaTranscode = {
  resolution?: "1080p" | "720p";
  fps?: "source" | 24 | 25 | 30 | 60;
};

type MediaJob = {
  mediaId: string;
  originalObjectKey: string;
  mode: "original" | "compress";
  transcode?: MediaTranscode;
};

type MediaMetadata = {
  durationMs?: number;
  width?: number;
  height?: number;
  sizeBytes?: number;
  bitrateKbps?: number;
  frameCount?: number;
};

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient({ log: ["error", "warn"] });
const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY
  }
});

function parseNumericString(value?: string | null) {
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function parseFrameRate(value?: string | null) {
  if (!value || value === "0/0") return undefined;
  const [numRaw, denRaw] = value.split("/");
  const num = Number(numRaw);
  const den = Number(denRaw ?? "1");
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return undefined;
  const fps = num / den;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}

async function readLocalMediaMetadata(filePath: string): Promise<MediaMetadata> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_format",
    "-show_streams",
    "-of",
    "json",
    filePath
  ]);

  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string; bit_rate?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      duration?: string;
      bit_rate?: string;
      nb_frames?: string;
      avg_frame_rate?: string;
      r_frame_rate?: string;
    }>;
  };

  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
  const durationSeconds =
    parseNumericString(videoStream?.duration) ??
    parseNumericString(parsed.format?.duration);
  const bitrate =
    parseNumericString(videoStream?.bit_rate) ??
    parseNumericString(parsed.format?.bit_rate);
  const explicitFrames = parseNumericString(videoStream?.nb_frames);
  const fps = parseFrameRate(videoStream?.avg_frame_rate) ?? parseFrameRate(videoStream?.r_frame_rate);
  const derivedFrameCount = !explicitFrames && durationSeconds && fps ? Math.round(durationSeconds * fps) : undefined;
  const fileStat = await stat(filePath);

  return {
    sizeBytes: fileStat.size,
    durationMs: durationSeconds ? Math.max(1, Math.round(durationSeconds * 1000)) : undefined,
    width: videoStream?.width,
    height: videoStream?.height,
    bitrateKbps: bitrate ? Math.max(1, Math.round(bitrate / 1000)) : undefined,
    frameCount: explicitFrames ? Math.max(1, Math.round(explicitFrames)) : derivedFrameCount ? Math.max(1, derivedFrameCount) : undefined
  };
}

async function downloadObjectToFile(bucket: string, objectKey: string, destinationPath: string) {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: objectKey
    })
  );

  const body = response.Body;
  if (!body || typeof (body as NodeJS.ReadableStream).pipe !== "function") {
    throw new Error(`Missing readable body for s3://${bucket}/${objectKey}`);
  }

  await pipeline(body as NodeJS.ReadableStream, createWriteStream(destinationPath));
}

async function uploadFileToObjectStorage(bucket: string, objectKey: string, filePath: string) {
  const fileStat = await stat(filePath);
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: createReadStream(filePath),
      ContentType: "video/mp4",
      ContentLength: fileStat.size
    })
  );
}

function buildFfmpegFilters(transcode?: MediaTranscode) {
  const filters: string[] = [];

  if (transcode?.resolution) {
    const targetHeight = transcode.resolution === "1080p" ? 1080 : 720;
    filters.push(`scale=-2:${targetHeight}:force_original_aspect_ratio=decrease`);
  }

  if (typeof transcode?.fps === "number") {
    filters.push(`fps=${transcode.fps}`);
  }

  return filters;
}

async function transcodeToPreview(inputPath: string, outputPath: string, transcode?: MediaTranscode) {
  const args = ["-y", "-i", inputPath];
  const filters = buildFfmpegFilters(transcode);

  if (filters.length > 0) {
    args.push("-vf", filters.join(","));
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    outputPath
  );

  await execFileAsync("ffmpeg", args);
}

async function processCompressJob(job: Job<MediaJob>) {
  const payload = job.data;
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "markreel-worker-"));
  const inputPath = path.join(tempDir, "input-source");
  const outputPath = path.join(tempDir, "preview.mp4");
  const derivedObjectKey = `derived/${payload.mediaId}/${Date.now()}-${payload.originalObjectKey.split("/").pop() ?? "preview"}.mp4`;

  try {
    await prisma.media.update({
      where: { id: payload.mediaId },
      data: { status: "processing" }
    });

    await job.updateProgress(10);
    await downloadObjectToFile(env.S3_BUCKET_ORIGINAL, payload.originalObjectKey, inputPath);

    await job.updateProgress(45);
    await transcodeToPreview(inputPath, outputPath, payload.transcode);

    await job.updateProgress(75);
    await uploadFileToObjectStorage(env.S3_BUCKET_DERIVED, derivedObjectKey, outputPath);

    const metadata = await readLocalMediaMetadata(outputPath);

    await prisma.mediaFile.update({
      where: {
        mediaId_originalObjectKey: {
          mediaId: payload.mediaId,
          originalObjectKey: payload.originalObjectKey
        }
      },
      data: {
        derivedPrefix: derivedObjectKey,
        durationMs: metadata.durationMs,
        width: metadata.width,
        height: metadata.height,
        sizeBytes: metadata.sizeBytes,
        bitrateKbps: metadata.bitrateKbps,
        frameCount: metadata.frameCount
      }
    });

    await prisma.media.update({
      where: { id: payload.mediaId },
      data: { status: "ready" }
    });

    await job.updateProgress(100);
    return {
      ok: true,
      mediaId: payload.mediaId,
      derivedObjectKey,
      transcode: payload.transcode
    };
  } catch (error) {
    await prisma.mediaFile.updateMany({
      where: {
        mediaId: payload.mediaId,
        originalObjectKey: payload.originalObjectKey
      },
      data: { derivedPrefix: null }
    }).catch(() => undefined);

    await prisma.media.update({
      where: { id: payload.mediaId },
      data: { status: "failed" }
    }).catch(() => undefined);

    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function main() {
  const connection = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });

  try {
    const info = await connection.info("server");
    const version = info.match(/redis_version:([^\r\n]+)/)?.[1]?.trim();
    const major = version ? Number.parseInt(version.split(".")[0] ?? "0", 10) : 0;

    if (!major || major < 5) {
      // eslint-disable-next-line no-console
      console.warn(
        `MarkReel worker skipped: Redis >= 5 required for BullMQ, current: ${version ?? "unknown"}`
      );
      await connection.quit();
      return;
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("MarkReel worker skipped: Redis unavailable", err);
    connection.disconnect();
    return;
  }

  const worker = new Worker<MediaJob>(
    "media",
    async (job) => {
      if (job.data.mode !== "compress") {
        await prisma.media.update({
          where: { id: job.data.mediaId },
          data: { status: "ready" }
        }).catch(() => undefined);
        await job.updateProgress(100);
        return {
          ok: true,
          mediaId: job.data.mediaId,
          passthrough: true
        };
      }

      return processCompressJob(job);
    },
    { connection: connection as unknown as ConnectionOptions }
  );

  worker.on("completed", (job) => {
    // eslint-disable-next-line no-console
    console.log("completed", job.id);
  });

  worker.on("failed", (job, err) => {
    // eslint-disable-next-line no-console
    console.error("failed", job?.id, err);
  });

  // eslint-disable-next-line no-console
  console.log("MarkReel worker started");
}

main().catch(async (err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
