import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { env } from "./env";
import { registerJwt } from "./auth/tokens";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { ensureStorageBuckets } from "./s3";

async function bootstrap() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((err, _req, reply) => {
    // Make local dev failures obvious (e.g. DB not running).
    const name = (err as any)?.name as string | undefined;
    const msg = (err as any)?.message as string | undefined;

    if (name === "PrismaClientInitializationError" || msg?.includes("Can't reach database server")) {
      return reply.code(503).send({ error: "database_unavailable" });
    }

    reply.log.error(err);
    return reply.code(500).send({ error: "internal_server_error" });
  });

  await app.register(cors, {
    origin: [env.WEB_BASE_URL],
    credentials: true
  });

  await app.register(cookie);
  await registerJwt(app);

  await app.register(multipart, {
    limits: {
      fileSize: 1024 * 1024 * 1024 // 1GB (MVP default)
    }
  });

  if (env.MARKREEL_STORE !== "inmemory") {
    await ensureStorageBuckets();
  }

  app.get("/health", async () => ({ ok: true }));
  app.get("/", async () => ({ name: "MarkReel API", status: "ok" }));

  await app.register(
    async (apiScope) => {
      await authRoutes(apiScope);
      await projectRoutes(apiScope);

      if (env.MARKREEL_STORE !== "inmemory") {
        const { mediaRoutes } = await import("./routes/media");
        const { folderRoutes } = await import("./routes/folders");
        const { annotationRoutes } = await import("./routes/annotations");
        const { attachmentRoutes } = await import("./routes/attachments");
        const { shareLinkRoutes } = await import("./routes/shareLinks");
        await mediaRoutes(apiScope);
        await folderRoutes(apiScope);
        await annotationRoutes(apiScope);
        await attachmentRoutes(apiScope);
        await shareLinkRoutes(apiScope);
      }
    },
    { prefix: "/api" }
  );

  await app.listen({ host: "0.0.0.0", port: 4000 });
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
