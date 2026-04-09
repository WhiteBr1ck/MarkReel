import { z } from "zod";
import * as dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";

const envCandidates = [
  process.env.MARKREEL_ENV_FILE,
  path.resolve(__dirname, "..", "..", "..", ".env.local"),
  path.resolve(__dirname, "..", "..", "..", ".env")
].filter((value): value is string => Boolean(value));

const envFile = envCandidates.find((candidate) => fs.existsSync(candidate)) ?? envCandidates[0]!;

dotenv.config({ path: envFile });

const EnvSchema = z.object({
  WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
  API_BASE_URL: z.string().url().default("http://localhost:4000"),

  // Storage backend: `sqlite` (default local persistent DB) or `inmemory` (dev only, volatile)
  MARKREEL_STORE: z.enum(["sqlite", "inmemory"]).default("sqlite"),

  JWT_ACCESS_SECRET: z.string().min(16).default("dev_access_secret_change_me_123456"),
  JWT_REFRESH_SECRET: z.string().min(16).default("dev_refresh_secret_change_me_123456"),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  JWT_REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000),

  DATABASE_URL: z.string().min(1).optional(),
  // Optional for local-only dev. If unset, background job queue is disabled.
  REDIS_URL: z.string().min(1).optional(),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_ORIGINAL: z.string().min(1),
  S3_BUCKET_DERIVED: z.string().min(1),
  S3_BUCKET_ATTACHMENTS: z.string().min(1),

  FFMPEG_THREADS: z.coerce.number().int().positive().default(2),
  HLS_SEGMENT_SECONDS: z.coerce.number().int().positive().default(4)
});

const parsed = EnvSchema.parse(process.env);

if (parsed.MARKREEL_STORE === "sqlite" && !parsed.DATABASE_URL) {
  throw new Error("DATABASE_URL is required when MARKREEL_STORE=sqlite");
}

export const env = parsed;
