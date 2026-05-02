import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { env } from "./env";
import { registerJwt } from "./auth/tokens";
import { authRoutes } from "./routes/auth";
import { projectRoutes } from "./routes/projects";
import { ensureStorageBuckets } from "./s3";
import { getStore } from "./store";
import { hashPassword } from "./auth/password";
import { userRoutes } from "./routes/users";
import { adminRoutes } from "./routes/admin";

function isStorageUnavailableError(err: unknown) {
  const error = err as {
    name?: string;
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };

  return (
    error?.code === "ECONNREFUSED" ||
    error?.code === "ENOTFOUND" ||
    error?.cause?.code === "ECONNREFUSED" ||
    error?.cause?.code === "ENOTFOUND" ||
    error?.name === "TimeoutError" ||
    error?.message?.includes("ECONNREFUSED") ||
    error?.message?.includes("ENOTFOUND")
  );
}

async function ensureAdminUser() {
  if (!env.MARKREEL_ADMIN_USERNAME || !env.MARKREEL_ADMIN_PASSWORD) return;
  const passwordHash = await hashPassword(env.MARKREEL_ADMIN_PASSWORD);
  await getStore().userEnsureAdmin({
    username: env.MARKREEL_ADMIN_USERNAME,
    passwordHash,
    displayName: env.MARKREEL_ADMIN_DISPLAY_NAME ?? null
  });
}

async function bootstrap() {
  const app = Fastify({ logger: true });

  app.setErrorHandler((err, _req, reply) => {
    // Make local dev failures obvious (e.g. DB not running).
    const name = (err as any)?.name as string | undefined;
    const msg = (err as any)?.message as string | undefined;

    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation_error", issues: err.issues });
    }

    if (name === "PrismaClientInitializationError" || msg?.includes("Can't reach database server")) {
      return reply.code(503).send({ error: "database_unavailable" });
    }

    if (isStorageUnavailableError(err)) {
      reply.log.warn(err, "Object storage unavailable");
      return reply.code(503).send({ error: "object_storage_unavailable" });
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
    try {
      await ensureStorageBuckets();
    } catch (err) {
      if (isStorageUnavailableError(err)) {
        app.log.warn(err, "Object storage unavailable during startup; continuing without bucket preflight");
      } else {
        throw err;
      }
    }
  }

  await ensureAdminUser();

  app.get("/health", async () => ({ ok: true }));
  app.get("/", async () => ({ name: "MarkReel API", status: "ok" }));

  await app.register(
    async (apiScope) => {
      await authRoutes(apiScope);
      await userRoutes(apiScope);
      await adminRoutes(apiScope);
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
