import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";
import type { S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "./env";

export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY
  }
});

export async function ensureStorageBuckets() {
  const buckets = [env.S3_BUCKET_ORIGINAL, env.S3_BUCKET_DERIVED, env.S3_BUCKET_ATTACHMENTS];

  for (const bucket of buckets) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }

    try {
      await s3.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedHeaders: ["*"],
                AllowedMethods: ["GET", "HEAD", "PUT"],
                AllowedOrigins: [env.WEB_BASE_URL],
                ExposeHeaders: ["ETag"],
                MaxAgeSeconds: 3600
              }
            ]
          }
        })
      );
    } catch (error) {
      const err = error as S3ServiceException & { Code?: string };
      if (err?.name === "NotImplemented" || err?.Code === "NotImplemented" || err?.$metadata?.httpStatusCode === 501) {
        console.warn(`[s3] Bucket CORS API not supported for ${bucket}; continuing without automatic CORS setup.`);
        continue;
      }
      throw error;
    }
  }
}

export async function presignPutObject(args: {
  bucket: string;
  objectKey: string;
  contentType?: string;
  expiresInSeconds?: number;
}) {
  const cmd = new PutObjectCommand({
    Bucket: args.bucket,
    Key: args.objectKey,
    ContentType: args.contentType
  });
  const url = await getSignedUrl(s3, cmd, {
    expiresIn: args.expiresInSeconds ?? 900
  });
  return url;
}

export async function statObject(args: {
  bucket: string;
  objectKey: string;
}) {
  const res = await s3.send(
    new HeadObjectCommand({
      Bucket: args.bucket,
      Key: args.objectKey
    })
  );

  return {
    sizeBytes: typeof res.ContentLength === "number" ? res.ContentLength : undefined,
    contentType: res.ContentType ?? undefined,
    etag: res.ETag ?? undefined,
    lastModified: res.LastModified ?? undefined
  };
}

export async function presignGetObject(args: {
  bucket: string;
  objectKey: string;
  expiresInSeconds?: number;
}) {
  const cmd = new GetObjectCommand({
    Bucket: args.bucket,
    Key: args.objectKey
  });
  const url = await getSignedUrl(s3, cmd, {
    expiresIn: args.expiresInSeconds ?? 900
  });
  return url;
}
