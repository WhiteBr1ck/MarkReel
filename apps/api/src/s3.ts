import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  PutBucketCorsCommand,
  S3Client
} from "@aws-sdk/client-s3";
import type { S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { FastifyRequest } from "fastify";
import { Readable } from "node:stream";
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

const publicS3Clients = new Map<string, S3Client>();

function getPublicS3(endpoint: string) {
  const cached = publicS3Clients.get(endpoint);
  if (cached) return cached;
  const client = new S3Client({
    region: env.S3_REGION,
    endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY
    }
  });
  publicS3Clients.set(endpoint, client);
  return client;
}

function resolveRequestProtocol(req: FastifyRequest) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (typeof forwardedProto === "string" && forwardedProto.trim()) return forwardedProto.split(",")[0]!.trim();
  return req.protocol || "http";
}

export function resolvePublicS3Endpoint(req?: FastifyRequest) {
  if (env.S3_PUBLIC_ENDPOINT) return env.S3_PUBLIC_ENDPOINT;
  if (!req) return null;
  const hostHeader = req.headers["x-forwarded-host"] ?? req.headers.host;
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host) return null;

  const protocol = resolveRequestProtocol(req);
  const hostname = host.includes(":") ? host.slice(0, host.lastIndexOf(":")) : host;
  if (!hostname || hostname === "api") return null;
  return `${protocol}://${hostname}:9000`;
}

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
  req?: FastifyRequest;
}) {
  const publicEndpoint = resolvePublicS3Endpoint(args.req);
  if (publicEndpoint) {
    return getSignedUrl(
      getPublicS3(publicEndpoint),
      new PutObjectCommand({
        Bucket: args.bucket,
        Key: args.objectKey,
        ContentType: args.contentType
      }),
      { expiresIn: args.expiresInSeconds ?? 3600 }
    );
  }

  return `/api/objects/${encodeURIComponent(args.bucket)}/${encodeURIComponent(args.objectKey)}`;
}

export async function putObjectStream(args: {
  bucket: string;
  objectKey: string;
  body: Readable;
  contentType?: string;
  contentLength?: number;
}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: args.bucket,
      Key: args.objectKey,
      Body: args.body,
      ContentType: args.contentType,
      ContentLength: args.contentLength
    })
  );
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

export async function getObjectStream(args: {
  bucket: string;
  objectKey: string;
  range?: string;
}) {
  const res = await s3.send(
    new GetObjectCommand({
      Bucket: args.bucket,
      Key: args.objectKey,
      Range: args.range
    })
  );

  return {
    body: res.Body as Readable | undefined,
    contentType: res.ContentType ?? undefined,
    contentLength: typeof res.ContentLength === "number" ? res.ContentLength : undefined,
    etag: res.ETag ?? undefined,
    lastModified: res.LastModified ?? undefined
  };
}

export async function presignGetObject(args: {
  bucket: string;
  objectKey: string;
  expiresInSeconds?: number;
  req?: FastifyRequest;
}) {
  const publicEndpoint = resolvePublicS3Endpoint(args.req);
  if (publicEndpoint) {
    return getSignedUrl(
      getPublicS3(publicEndpoint),
      new GetObjectCommand({
        Bucket: args.bucket,
        Key: args.objectKey
      }),
      { expiresIn: args.expiresInSeconds ?? 3600 }
    );
  }

  return `/api/objects/${encodeURIComponent(args.bucket)}/${encodeURIComponent(args.objectKey)}`;
}

