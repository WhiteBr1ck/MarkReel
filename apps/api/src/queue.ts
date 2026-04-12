import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

export type MediaTranscode = {
  resolution?: "1080p" | "720p";
  fps?: "source" | 24 | 25 | 30 | 60;
};

export type MediaJob = {
  mediaId: string;
  originalObjectKey: string;
  mode: "original" | "compress";
  transcode?: MediaTranscode;
};

export const mediaQueue = (() => {
  if (!env.REDIS_URL) return null;

  // Use lazyConnect so API can boot without Redis.
  const connection = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    enableOfflineQueue: false
  });

  return new Queue<MediaJob>("media", { connection: connection as unknown as ConnectionOptions });
})();
