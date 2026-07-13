import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { prisma } from "./db";
import { presignInternalGetObject } from "./s3";

const execFileAsync = promisify(execFile);

const ProbeFormatSchema = z.object({
  format_name: z.string().optional(),
  duration: z.string().optional(),
  bit_rate: z.string().optional()
});

const ProbeStreamSchema = z.object({
  codec_type: z.string().optional(),
  codec_name: z.string().optional(),
  profile: z.string().optional(),
  pix_fmt: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  duration: z.string().optional(),
  bit_rate: z.string().optional(),
  nb_frames: z.string().optional(),
  avg_frame_rate: z.string().optional(),
  r_frame_rate: z.string().optional()
});

const ProbeResultSchema = z.object({
  format: ProbeFormatSchema.optional(),
  streams: z.array(ProbeStreamSchema).optional()
});

export const technicalMetadataSelect = {
  formatName: true,
  videoCodec: true,
  videoProfile: true,
  videoPixelFormat: true,
  videoFrameRate: true,
  videoBitrateKbps: true,
  audioCodec: true,
  audioBitrateKbps: true,
  technicalMetadataProbedAt: true
} as const;

type StoredMediaFile = {
  id: string;
  sizeBytes: bigint | null;
  formatName: string | null;
  videoCodec: string | null;
  videoProfile: string | null;
  videoPixelFormat: string | null;
  videoFrameRate: number | null;
  videoBitrateKbps: number | null;
  audioCodec: string | null;
  audioBitrateKbps: number | null;
  technicalMetadataProbedAt: Date | null;
};

type MediaTarget = {
  bucket: string;
  objectKey: string;
};

export async function ensureTechnicalMetadata(file: StoredMediaFile, target: MediaTarget) {
  if (file.technicalMetadataProbedAt) return pickTechnicalMetadata(file);

  const sourceUrl = await presignInternalGetObject(target);
  let stdout: string;
  try {
    const result = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_format",
      "-show_streams",
      "-of",
      "json",
      sourceUrl
    ], { timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    stdout = result.stdout;
  } catch {
    throw new Error("technical_metadata_probe_failed");
  }

  const metadata = parseProbeResult(stdout);
  return prisma.mediaFile.update({
    where: { id: file.id },
    data: {
      ...metadata,
      technicalMetadataProbedAt: new Date()
    },
    select: technicalMetadataSelect
  });
}

function pickTechnicalMetadata(file: StoredMediaFile) {
  return {
    formatName: file.formatName,
    videoCodec: file.videoCodec,
    videoProfile: file.videoProfile,
    videoPixelFormat: file.videoPixelFormat,
    videoFrameRate: file.videoFrameRate,
    videoBitrateKbps: file.videoBitrateKbps,
    audioCodec: file.audioCodec,
    audioBitrateKbps: file.audioBitrateKbps,
    technicalMetadataProbedAt: file.technicalMetadataProbedAt
  };
}

function parseProbeResult(stdout: string) {
  const parsed = ProbeResultSchema.parse(JSON.parse(stdout));
  const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
  const audioStream = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const videoBitrate = parseNumericString(videoStream?.bit_rate);
  const audioBitrate = parseNumericString(audioStream?.bit_rate);
  const videoFrameRate = parseFrameRate(videoStream?.avg_frame_rate) ?? parseFrameRate(videoStream?.r_frame_rate);

  return {
    formatName: parsed.format?.format_name,
    videoCodec: videoStream?.codec_name,
    videoProfile: videoStream?.profile,
    videoPixelFormat: videoStream?.pix_fmt,
    videoFrameRate,
    videoBitrateKbps: videoBitrate ? Math.max(1, Math.round(videoBitrate / 1000)) : undefined,
    audioCodec: audioStream?.codec_name,
    audioBitrateKbps: audioBitrate ? Math.max(1, Math.round(audioBitrate / 1000)) : undefined
  };
}

function parseNumericString(value?: string | null) {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseFrameRate(value?: string | null) {
  if (!value || value === "0/0") return undefined;
  const [numeratorRaw, denominatorRaw] = value.split("/");
  const numerator = Number(numeratorRaw);
  const denominator = Number(denominatorRaw ?? "1");
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return undefined;
  const fps = numerator / denominator;
  return Number.isFinite(fps) && fps > 0 ? fps : undefined;
}
