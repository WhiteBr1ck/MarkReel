import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { ZodError } from "zod";
import { setupMediaSeriesTestSchema } from "./mediaSeriesFixtures";

const directory = mkdtempSync(path.join(os.tmpdir(), "markreel-series-"));
const envPath = path.join(directory, "test.env");
writeFileSync(envPath, "");
Object.assign(process.env, {
  MARKREEL_ENV_FILE: envPath, MARKREEL_STORE: "sqlite", MARKREEL_SKIP_BOOTSTRAP: "true",
  DATABASE_URL: `file:${path.join(directory, "series.db").replace(/\\/g, "/")}`,
  JWT_ACCESS_SECRET: "series_access_secret_123456789", JWT_REFRESH_SECRET: "series_refresh_secret_123456789",
  JWT_AUTH_INSTANCE_ID: "series-test-instance", S3_ENDPOINT: "http://127.0.0.1:1", S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "test", S3_SECRET_KEY: "test", S3_BUCKET_ORIGINAL: "original",
  S3_BUCKET_DERIVED: "derived", S3_BUCKET_ATTACHMENTS: "attachments"
});
delete process.env.REDIS_URL;

let prisma: typeof import("./db")["prisma"];
let series: typeof import("./mediaSeries");
let app: FastifyInstance;
let ownerCookie: string;
let viewerCookie: string;
let editorCookie: string;
let outsiderCookie: string;

before(async () => {
  ({ prisma } = await import("./db"));
  await setupMediaSeriesTestSchema(prisma);
  series = await import("./mediaSeries");
  await prisma.user.createMany({ data: ["owner", "viewer", "editor", "outsider"].map((id) => ({ id, username: `series_${id}`, passwordHash: "unused" })) });
  await prisma.project.createMany({ data: ["project", "other"].map((id) => ({ id, name: id, ownerId: "owner" })) });
  await prisma.projectMember.createMany({ data: [{ projectId: "project", userId: "viewer", role: "viewer" }, { projectId: "project", userId: "editor", role: "editor" }] });
  app = Fastify();
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "validation_error" });
    return reply.code(error.statusCode ?? 500).send({ error: error.code ?? error.message });
  });
  await app.register(cookie);
  const { registerJwt } = await import("./auth/tokens");
  await registerJwt(app);
  await app.register(async (scope) => {
    await (await import("./routes/media")).mediaRoutes(scope);
    await (await import("./routes/projects")).projectRoutes(scope);
    await (await import("./routes/shareLinks")).shareLinkRoutes(scope);
  }, { prefix: "/api" });
  await app.ready();
  const auth = (sub: string) => `mr_access=${app.jwt.sign({ sub, sv: 1, si: "series-test-instance" })}`;
  ownerCookie = auth("owner"); viewerCookie = auth("viewer"); editorCookie = auth("editor"); outsiderCookie = auth("outsider");
});

after(async () => {
  await app?.close();
  await prisma?.$disconnect();
  rmSync(directory, { recursive: true, force: true });
});

async function legacy(id: string, extra: { folderId?: string; status?: "ready" | "uploaded"; creatorId?: string } = {}) {
  return prisma.media.create({ data: { id, projectId: "project", creatorId: "owner", title: id, ...extra } });
}

async function createVersion(sourceMediaId: string, extra: { seriesId?: string; projectId?: string } = {}) {
  return series.createMediaVersion({ userId: "owner", projectId: "project", title: "Revision", sourceMediaId, ...extra });
}

test("legacy media stays ungrouped until upgraded, then preserves V1 data", async () => {
  const source = await legacy("legacy");
  const annotation = await prisma.annotation.create({ data: { projectId: "project", mediaId: source.id, authorId: "owner", type: "text", timestampMs: 0, body: "V1 only" } });
  await prisma.attachment.create({ data: { annotationId: annotation.id, kind: "image", objectKey: "attachments/v1.png" } });
  await prisma.mediaRating.create({ data: { mediaId: source.id, userId: "owner", value: 4 } });
  const oldHistory = await series.getMediaVersionHistory("owner", source.id);
  assert.equal(oldHistory.seriesId, null);
  assert.equal(oldHistory.versions.length, 1);
  assert.equal(source.seriesId, null);
  const next = await createVersion(source.id);
  assert.equal(next.versionIndex, 2);
  const first = await prisma.media.findUniqueOrThrow({ where: { id: source.id } });
  assert.equal(first.seriesId, next.seriesId);
  assert.equal(first.versionIndex, 1);
  assert.equal(await prisma.annotation.count({ where: { mediaId: next.id } }), 0);
  assert.equal(await prisma.mediaRating.count({ where: { mediaId: next.id } }), 0);
  assert.equal(await prisma.attachment.count({ where: { annotation: { mediaId: next.id } } }), 0);
  assert.equal(await prisma.attachment.count({ where: { annotationId: annotation.id } }), 1);
  assert.equal((await prisma.mediaRating.findFirstOrThrow({ where: { mediaId: first.id } })).value, 4);
});

test("simultaneous first upgrades and later uploads allocate unique consecutive versions", async () => {
  await legacy("concurrent");
  const batch = await Promise.all(Array.from({ length: 12 }, () => createVersion("concurrent")));
  assert.equal(new Set(batch.map((item) => item.seriesId)).size, 1);
  assert.deepEqual(batch.map((item) => item.versionIndex).sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index + 2));
  const bySeries = await series.createMediaVersion({ userId: "owner", projectId: "project", title: "V14", seriesId: batch[0].seriesId! });
  assert.equal(bySeries.versionIndex, 14);
});

test("independent API processes allocate distinct versions against the same SQLite database", async () => {
  await legacy("multi-process");
  const serviceUrl = pathToFileURL(path.join(__dirname, "mediaSeries.ts")).href;
  const dbUrl = pathToFileURL(path.join(__dirname, "db.ts")).href;
  const script = `
    (async () => {
      const service = await import(${JSON.stringify(serviceUrl)});
      const database = await import(${JSON.stringify(dbUrl)});
      const { createMediaVersion } = service.default ?? service;
      const { prisma } = database.default ?? database;
      try {
        for (let index = 0; index < 4; index += 1) {
          await createMediaVersion({ userId: "owner", projectId: "project", sourceMediaId: "multi-process", title: "Concurrent revision" });
        }
      } finally { await prisma.$disconnect(); }
    })().catch((error) => { console.error(error); process.exitCode = 1; });`;
  await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, ["--import", "tsx", "--eval", script], { env: process.env, timeout: 45000 })));
  const source = await prisma.media.findUniqueOrThrow({ where: { id: "multi-process" } });
  const versions = await prisma.media.findMany({ where: { seriesId: source.seriesId }, orderBy: { versionIndex: "asc" }, select: { versionIndex: true } });
  assert.deepEqual(versions.map((version) => version.versionIndex), Array.from({ length: 17 }, (_, index) => index + 1));
});

test("database unique constraint rejects duplicate version indices", async () => {
  await legacy("unique");
  const version = await createVersion("unique");
  await assert.rejects(prisma.media.create({ data: { projectId: "project", title: "Duplicate", seriesId: version.seriesId, versionIndex: version.versionIndex } }), { code: "P2002" });
});

test("project managers can initialize a legacy empty series, but upload-only users cannot", async () => {
  const empty = await prisma.mediaSeries.create({ data: { projectId: "project", title: "Empty" } });
  await assert.rejects(series.createMediaVersion({ userId: "editor", projectId: "project", title: "Denied", seriesId: empty.id }), { code: "not_found" });
  const first = await series.createMediaVersion({ userId: "owner", projectId: "project", title: "First", seriesId: empty.id });
  assert.equal(first.seriesId, empty.id);
  assert.equal(first.versionIndex, 1);
});

test("existing series counters catch up to old versions including deleted ones", async () => {
  const oldSeries = await prisma.mediaSeries.create({ data: { projectId: "project", title: "Old series" } });
  await prisma.media.createMany({ data: [{ id: "old-v1", projectId: "project", title: "V1", seriesId: oldSeries.id, versionIndex: 1, creatorId: "owner" }, { id: "old-v9", projectId: "project", title: "V9", seriesId: oldSeries.id, versionIndex: 9, deletedAt: new Date() }] });
  const version = await createVersion("old-v1");
  assert.equal(version.versionIndex, 10);
  await prisma.media.delete({ where: { id: version.id } });
  assert.equal((await createVersion("old-v1")).versionIndex, 11);
});

test("cross-project sources and series, mismatched pairs and denied capabilities are rejected", async () => {
  await legacy("scoped");
  const version = await createVersion("scoped");
  const other = await prisma.mediaSeries.create({ data: { projectId: "other", title: "Other" } });
  await assert.rejects(createVersion("scoped", { projectId: "other" }), { code: "not_found" });
  await assert.rejects(createVersion("scoped", { seriesId: other.id }), { code: "not_found" });
  await assert.rejects(series.createMediaVersion({ userId: "owner", projectId: "other", title: "No", seriesId: version.seriesId! }), { code: "not_found" });
  await assert.rejects(series.createMediaVersion({ userId: "viewer", projectId: "project", title: "No", sourceMediaId: "scoped" }), { code: "not_found" });
  await assert.rejects(series.createMediaVersion({ userId: "editor", projectId: "project", title: "No", sourceMediaId: "scoped" }), { code: "not_found" });
  await assert.rejects(series.getMediaVersionHistory("outsider", "scoped"), { code: "not_found" });
  assert.equal((await series.getMediaVersionHistory("viewer", "scoped")).canUploadVersion, false);
});

test("versions inherit source folders and reject foreign folders", async () => {
  await prisma.projectFolder.createMany({ data: [{ id: "same-folder", projectId: "project", name: "Same" }, { id: "foreign-folder", projectId: "other", name: "Foreign" }] });
  await legacy("folder-source", { folderId: "same-folder" });
  assert.equal((await createVersion("folder-source")).folderId, "same-folder");
  await assert.rejects(series.createMediaVersion({ userId: "owner", projectId: "project", title: "No", sourceMediaId: "folder-source", folderId: "foreign-folder" }), { code: "folder_not_found" });
});

test("workspace chooses the latest playable version without hiding equal-title legacy media", async () => {
  await legacy("playable", { status: "ready" });
  await prisma.mediaFile.create({ data: { mediaId: "playable", mode: "original", originalObjectKey: "original/playable/video.mp4" } });
  const pending = await createVersion("playable");
  await prisma.media.createMany({ data: ["same-title-a", "same-title-b"].map((id) => ({ id, projectId: "project", title: "Same title" })) });
  const workspace = await app.inject({ method: "GET", url: "/api/projects/project/workspace", headers: { cookie: ownerCookie } });
  assert.equal(workspace.statusCode, 200, workspace.body);
  const items = workspace.json().items as Array<{ id: string; seriesId: string; versionIndex: number; versionCount: number }>;
  const representative = items.find((item) => item.seriesId === pending.seriesId)!;
  assert.equal(representative.id, "playable");
  assert.equal(representative.versionIndex, 1);
  assert.equal(representative.versionCount, 2);
  assert.ok(items.some((item) => item.id === "same-title-a"));
  assert.ok(items.some((item) => item.id === "same-title-b"));
  await prisma.media.update({ where: { id: pending.id }, data: { status: "ready" } });
  await prisma.mediaFile.create({ data: { mediaId: pending.id, mode: "compress", originalObjectKey: `original/${pending.id}/source.mp4`, derivedPrefix: "derived/v2.mp4" } });
  const readyWorkspace = await app.inject({ method: "GET", url: "/api/projects/project/workspace", headers: { cookie: ownerCookie } });
  assert.ok(readyWorkspace.json().items.some((item: { id: string }) => item.id === pending.id));
});

test("creation and history HTTP endpoints remain compatible and expose uploader and time", async () => {
  const response = await app.inject({ method: "POST", url: "/api/projects/project/media", headers: { cookie: ownerCookie }, payload: { title: "HTTP legacy" } });
  assert.equal(response.statusCode, 201, response.body);
  const original = response.json().media;
  assert.equal(original.seriesId, null);
  const next = await app.inject({ method: "POST", url: "/api/projects/project/media", headers: { cookie: ownerCookie }, payload: { title: "HTTP V2", sourceMediaId: original.id } });
  assert.equal(next.statusCode, 201, next.body);
  assert.equal(next.json().media.versionIndex, 2);
  const history = await app.inject({ method: "GET", url: `/api/media/${original.id}/versions`, headers: { cookie: ownerCookie } });
  assert.equal(history.statusCode, 200, history.body);
  assert.equal(history.json().versions.length, 2);
  assert.equal(history.json().versions[0].creator.id, "owner");
  assert.ok(history.json().versions[0].createdAt);
  assert.equal(history.json().versions[0].files, undefined);
  for (const auth of [viewerCookie, editorCookie, outsiderCookie]) {
    const denied = await app.inject({ method: "POST", url: "/api/projects/project/media", headers: { cookie: auth }, payload: { title: "Forbidden", sourceMediaId: original.id } });
    assert.equal(denied.statusCode, 404, denied.body);
  }
});

test("single-version deletion keeps siblings; series deletion is explicit, scoped and blocks restore", async () => {
  await legacy("delete-source");
  const next = await createVersion("delete-source");
  const single = await app.inject({ method: "DELETE", url: `/api/media/${next.id}`, headers: { cookie: ownerCookie } });
  assert.equal(single.statusCode, 200, single.body);
  assert.equal((await prisma.media.findUniqueOrThrow({ where: { id: "delete-source" } })).deletedAt, null);
  assert.equal((await series.getMediaVersionHistory("owner", "delete-source")).versions.length, 1);
  const otherProject = await app.inject({ method: "DELETE", url: `/api/projects/other/media-series/${next.seriesId}`, headers: { cookie: ownerCookie } });
  assert.equal(otherProject.statusCode, 404);
  const viewer = await app.inject({ method: "DELETE", url: `/api/projects/project/media-series/${next.seriesId}`, headers: { cookie: viewerCookie } });
  assert.equal(viewer.statusCode, 404);
  const all = await app.inject({ method: "DELETE", url: `/api/projects/project/media-series/${next.seriesId}`, headers: { cookie: ownerCookie } });
  assert.equal(all.statusCode, 200, all.body);
  assert.equal(all.json().deleted, 1);
  await assert.rejects(createVersion("delete-source"), { code: "not_found" });
  const restore = await app.inject({ method: "POST", url: "/api/media/delete-source/restore", headers: { cookie: ownerCookie } });
  assert.equal(restore.statusCode, 409);
  assert.equal(restore.json().error, "series_deleted");
});

test("share tokens never authorize version history or another version", async () => {
  await legacy("shared-v1");
  const next = await createVersion("shared-v1");
  const { sha256Hex } = await import("./share");
  const token = "series-single-version-share";
  await prisma.shareLink.create({ data: { tokenHash: sha256Hex(token), mediaId: "shared-v1", createdById: "owner", permissions: { create: { permission: "view" } } } });
  const shared = await app.inject({ method: "GET", url: `/api/share/${token}/media` });
  assert.equal(shared.statusCode, 200, shared.body);
  assert.equal(shared.json().media.id, "shared-v1");
  assert.equal(shared.json().versions, undefined);
  const unauthenticated = await app.inject({ method: "GET", url: `/api/media/${next.id}/versions`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(unauthenticated.statusCode, 401);
  const outsider = await app.inject({ method: "GET", url: `/api/media/${next.id}/versions`, headers: { cookie: outsiderCookie } });
  assert.equal(outsider.statusCode, 404);
});

test("server import rejects a cross-project series before reading storage", async () => {
  await legacy("import-source");
  const version = await createVersion("import-source");
  const response = await app.inject({ method: "POST", url: "/api/projects/other/media/import/server", headers: { cookie: ownerCookie }, payload: { path: "video.mp4", seriesId: version.seriesId } });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "not_found");
});

test("process cannot register an original belonging to another mediaId", async () => {
  await legacy("process-source");
  const response = await app.inject({ method: "POST", url: "/api/media/process-source/process", headers: { cookie: ownerCookie }, payload: { mode: "original", originalObjectKey: "original/another/video.mp4" } });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_object_key");
});
