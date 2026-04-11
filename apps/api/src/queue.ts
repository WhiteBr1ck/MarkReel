import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

export type MediaJob = {
  mediaId: string;
  originalObjectKey: string;
  mode: "original" | "compress";
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
