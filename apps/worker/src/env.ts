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
  REDIS_URL: z.string().min(1),
  DATABASE_URL: z.string().min(1),

  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().default("us-east-1"),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_BUCKET_ORIGINAL: z.string().min(1),
  S3_BUCKET_DERIVED: z.string().min(1),

  FFMPEG_THREADS: z.coerce.number().int().positive().default(2),
  HLS_SEGMENT_SECONDS: z.coerce.number().int().positive().default(4)
});

export const env = EnvSchema.parse(process.env);
