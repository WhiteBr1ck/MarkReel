import { Worker } from "bullmq";
import IORedis from "ioredis";
import { env } from "./env";

type MediaJob = {
  mediaId: string;
  originalObjectKey: string;
  mode: "original" | "compress";
};

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
      job.updateProgress(1);
      return {
        ok: true,
        received: job.data
      };
    },
    { connection }
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

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
