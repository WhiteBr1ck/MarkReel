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
import { hashPassword, verifyPassword } from "./auth/password";
import { userRoutes } from "./routes/users";
import { adminRoutes } from "./routes/admin";
import { organizationRoutes } from "./routes/organizations";
import { prisma } from "./db";

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

  const store = getStore();
  const existing = await store.userFindByUsername(env.MARKREEL_ADMIN_USERNAME);
  if (existing) {
    const passwordMatches = await verifyPassword(env.MARKREEL_ADMIN_PASSWORD, existing.passwordHash);
    const admin = await store.userEnsureAdmin({
      username: env.MARKREEL_ADMIN_USERNAME,
      passwordHash: existing.passwordHash,
      displayName: env.MARKREEL_ADMIN_DISPLAY_NAME ?? null
    });
    if (!passwordMatches) {
      await store.adminResetUserPassword({
        userId: admin.id,
        passwordHash: await hashPassword(env.MARKREEL_ADMIN_PASSWORD),
        nextSessionVersion: admin.sessionVersion + 1
      });
    }
    return;
  }

  const passwordHash = await hashPassword(env.MARKREEL_ADMIN_PASSWORD);
  await store.userEnsureAdmin({
    username: env.MARKREEL_ADMIN_USERNAME,
    passwordHash,
    displayName: env.MARKREEL_ADMIN_DISPLAY_NAME ?? null
  });
}

async function ensureDefaultOrganization() {
  if (env.MARKREEL_STORE === "inmemory") return;
  const existing = await prisma.organization.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  const admin = env.MARKREEL_ADMIN_USERNAME
    ? await getStore().userFindByUsername(env.MARKREEL_ADMIN_USERNAME)
    : null;
  const fallbackUser = admin ?? await prisma.user.findFirst({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
  if (!fallbackUser) return;

  const organization = existing ?? await prisma.organization.create({
    data: {
      name: "Default Organization",
      createdById: fallbackUser.id,
      members: { create: { userId: fallbackUser.id, role: "owner" } }
    }
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: organization.id, userId: fallbackUser.id } },
    update: {},
    create: { organizationId: organization.id, userId: fallbackUser.id, role: "owner" }
  });
  const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true } });
  await Promise.all(users
    .filter((user) => user.id !== fallbackUser.id)
    .map((user) => prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: organization.id, userId: user.id } },
      update: {},
      create: { organizationId: organization.id, userId: user.id, role: "member" }
    })));
  await prisma.project.updateMany({ where: { organizationId: null }, data: { organizationId: organization.id } });
}

export async function buildApp() {
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

    if ((err as any)?.code === "upload_aborted") {
      reply.log.warn(err, "Upload aborted before object storage write completed");
      return reply.code(499).send({ error: "upload_aborted" });
    }

    const statusCode = (err as any)?.statusCode;
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send({ error: (err as any)?.code ?? "request_error" });
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

  app.addContentTypeParser("*", (_req, payload, done) => {
    done(null, payload);
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
  await ensureDefaultOrganization();

  app.get("/health", async () => ({ ok: true }));
  app.get("/", async () => ({ name: "MarkReel API", status: "ok" }));

  await app.register(
    async (apiScope) => {
      await authRoutes(apiScope);
      await userRoutes(apiScope);
      await adminRoutes(apiScope);
      await organizationRoutes(apiScope);
      await projectRoutes(apiScope);

      if (env.MARKREEL_STORE !== "inmemory") {
        const { mediaRoutes } = await import("./routes/media");
        const { folderRoutes } = await import("./routes/folders");
        const { annotationRoutes } = await import("./routes/annotations");
        const { attachmentRoutes } = await import("./routes/attachments");
        const { shareLinkRoutes } = await import("./routes/shareLinks");
        const { projectMemberRoutes } = await import("./routes/projectMembers");
        const { objectRoutes } = await import("./routes/objects");
        await mediaRoutes(apiScope);
        await folderRoutes(apiScope);
        await annotationRoutes(apiScope);
        await attachmentRoutes(apiScope);
        await shareLinkRoutes(apiScope);
        await projectMemberRoutes(apiScope);
        await objectRoutes(apiScope);
      }
    },
    { prefix: "/api" }
  );

  return app;
}

async function bootstrap() {
  const app = await buildApp();

  await app.listen({ host: "0.0.0.0", port: 4000 });
}

if (process.env.MARKREEL_SKIP_BOOTSTRAP !== "true") {
  bootstrap().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
