import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { ZodError } from "zod";

const dbPath = path.join(os.tmpdir(), `markreel-annotation-history-${process.pid}-${Date.now()}.db`);
Object.assign(process.env, {
  MARKREEL_SKIP_BOOTSTRAP: "true",
  MARKREEL_STORE: "sqlite",
  DATABASE_URL: `file:${dbPath.replace(/\\/g, "/")}`,
  WEB_BASE_URL: "http://localhost:5090",
  API_BASE_URL: "http://localhost:4000",
  JWT_ACCESS_SECRET: "annotation_history_access_secret_123456",
  JWT_REFRESH_SECRET: "annotation_history_refresh_secret_123456",
  JWT_AUTH_INSTANCE_ID: "annotation-history-test",
  S3_ENDPOINT: "http://127.0.0.1:1",
  S3_REGION: "us-east-1",
  S3_ACCESS_KEY: "test",
  S3_SECRET_KEY: "test",
  S3_BUCKET_ORIGINAL: "original",
  S3_BUCKET_DERIVED: "derived",
  S3_BUCKET_ATTACHMENTS: "attachments"
});

type Mutation = { id: string; historyToken: string; updatedAt: string };

test("persistent annotation history, concurrency and share authorization", async (t) => {
  const { prisma } = await import("./db");
  await prisma.$executeRawUnsafe("PRAGMA user_version = 0");
  await prisma.$disconnect();
  execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--schema", path.resolve(__dirname, "../prisma/schema.prisma"), "--skip-generate"], { env: process.env, stdio: "pipe" });
  const { registerJwt, authInstanceId } = await import("./auth/tokens");
  const { annotationRoutes } = await import("./routes/annotations");
  const { shareLinkRoutes } = await import("./routes/shareLinks");
  const { registerAnnotationExportShareVisits } = await import("./annotationExportShareAccess");
  const { sha256Hex } = await import("./share");
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: "validation_error" });
    const failure = error as Error & { statusCode?: number; code?: string };
    return reply.code(failure.statusCode ?? 500).send({ error: failure.code ?? failure.message });
  });
  await app.register(cookie);
  await registerJwt(app);
  registerAnnotationExportShareVisits(app);
  await app.register(async (scope) => { await annotationRoutes(scope); await shareLinkRoutes(scope); }, { prefix: "/api" });
  await app.ready();
  try {
    for (const id of ["owner", "reviewer", "viewer", "outsider"]) await prisma.user.create({ data: { id, username: `history_${id}`, passwordHash: "unused" } });
    await prisma.project.create({ data: { id: "project", ownerId: "owner", name: "History project", members: { create: [{ userId: "reviewer", role: "viewer" }, { userId: "viewer", role: "viewer" }] } } });
    await prisma.media.create({ data: { id: "media", projectId: "project", creatorId: "owner", title: "Review", permissionGrants: { create: { subjectType: "invited_user", subjectKey: "reviewer", subjectUserId: "reviewer", permission: "annotate" } } } });
    await prisma.media.create({ data: { id: "other-media", projectId: "project", creatorId: "owner", title: "Other version" } });
    const headers = (actor = "owner") => ({ cookie: `mr_access=${app.jwt.sign({ sub: actor, sv: 1, si: authInstanceId })}` });
    const create = async (body: string, extra: Record<string, unknown> = {}, actor = "owner") => {
      const result = await app.inject({ method: "POST", url: "/api/media/media/annotations", headers: headers(actor), payload: { timestampMs: 1000, type: "text", body, ...extra } });
      assert.equal(result.statusCode, 201, result.body);
      return result.json<Mutation>();
    };
    const travel = async (entry: Mutation, actor = "owner", prefix = "") => app.inject({ method: "POST", url: `/api${prefix}/annotations/${entry.id}/history`, headers: headers(actor), payload: { historyToken: entry.historyToken } });
    const active = (id: string) => prisma.annotation.findFirst({ where: { id, deletedAt: null }, include: { attachments: true } });

    await t.test("create/edit/completion support consecutive undo and redo with stable IDs", async () => {
      const original = await create("original", { color: "#c96442" });
      const edit = await app.inject({ method: "PATCH", url: `/api/annotations/${original.id}`, headers: headers(), payload: { body: "edited", expectedUpdatedAt: original.updatedAt } });
      assert.equal(edit.statusCode, 200, edit.body);
      const edited = edit.json<Mutation>();
      const complete = await app.inject({ method: "PATCH", url: `/api/annotations/${original.id}/completion`, headers: headers(), payload: { completed: true, expectedUpdatedAt: edited.updatedAt } });
      assert.equal(complete.statusCode, 200, complete.body);
      const undoComplete = await travel(complete.json());
      assert.equal(undoComplete.statusCode, 200, undoComplete.body);
      assert.equal((await active(original.id))?.completedAt, null);
      const undoEdit = await travel(edited);
      assert.equal(undoEdit.statusCode, 200, undoEdit.body);
      assert.equal((await active(original.id))?.body, "original");
      const undoCreate = await travel(original);
      assert.equal(undoCreate.statusCode, 200, undoCreate.body);
      assert.equal(await active(original.id), null);
      const redoCreate = await travel(undoCreate.json());
      assert.equal(redoCreate.statusCode, 200, redoCreate.body);
      assert.equal((await active(original.id))?.color, "#c96442");
      const redoEdit = await travel(undoEdit.json());
      assert.equal(redoEdit.statusCode, 200, redoEdit.body);
      const redoComplete = await travel(undoComplete.json());
      assert.equal(redoComplete.statusCode, 200, redoComplete.body);
      assert.equal((await active(original.id))?.body, "edited");
      assert.ok((await active(original.id))?.completedAt);
    });

    await t.test("delete restores the exact live replies and attachment IDs, not previously deleted replies", async () => {
      const original = await create("thread", { attachments: [{ kind: "image", objectKey: "attachments/original.png" }] });
      const liveReply = await create("live reply", { parentId: original.id }, "reviewer");
      const deadReply = await create("deleted reply", { parentId: original.id });
      const removeReply = await app.inject({ method: "DELETE", url: `/api/annotations/${deadReply.id}`, headers: headers(), payload: { expectedUpdatedAt: deadReply.updatedAt } });
      assert.equal(removeReply.statusCode, 200, removeReply.body);
      const before = await active(original.id);
      const remove = await app.inject({ method: "DELETE", url: `/api/annotations/${original.id}`, headers: headers(), payload: { expectedUpdatedAt: before!.updatedAt.toISOString() } });
      assert.equal(remove.statusCode, 200, remove.body);
      assert.equal(await active(liveReply.id), null);
      const restore = await travel(remove.json());
      assert.equal(restore.statusCode, 200, restore.body);
      assert.equal((await active(liveReply.id))?.authorId, "reviewer");
      assert.equal(await active(deadReply.id), null);
      assert.deepEqual((await active(original.id))?.attachments, before?.attachments);
      const redoDelete = await travel(restore.json());
      assert.equal(redoDelete.statusCode, 200, redoDelete.body);
      assert.equal(await active(original.id), null);
      assert.equal(await active(liveReply.id), null);
    });

    await t.test("stale edits and undo after a collaborator reply are rejected without overwriting", async () => {
      const original = await create("keep me");
      const reply = await create("collaborator", { parentId: original.id }, "reviewer");
      const stale = await app.inject({ method: "PATCH", url: `/api/annotations/${original.id}`, headers: headers(), payload: { body: "overwrite", expectedUpdatedAt: original.updatedAt } });
      assert.equal(stale.statusCode, 409, stale.body);
      const undo = await travel(original);
      assert.equal(undo.statusCode, 409, undo.body);
      assert.equal((await active(original.id))?.body, "keep me");
      assert.equal((await active(reply.id))?.body, "collaborator");
    });

    await t.test("concurrent updates with one expected version cannot both commit", async () => {
      const original = await create("concurrent original");
      const updates = await Promise.all(["first writer", "second writer"].map((body) => app.inject({ method: "PATCH", url: `/api/annotations/${original.id}`, headers: headers(), payload: { body, expectedUpdatedAt: original.updatedAt } })));
      assert.deepEqual(updates.map((response) => response.statusCode).sort(), [200, 409]);
      const winner = updates.findIndex((response) => response.statusCode === 200);
      assert.equal((await active(original.id))?.body, winner === 0 ? "first writer" : "second writer");
    });

    await t.test("undo does not overwrite a later body, attachment or completion update", async () => {
      for (const change of [{ body: "collaborator edit" }, { attachments: [{ kind: "image", objectKey: "attachments/new.png" }] }]) {
        const original = await create("retained");
        const changed = await app.inject({ method: "PATCH", url: `/api/annotations/${original.id}`, headers: headers(), payload: { ...change, expectedUpdatedAt: original.updatedAt } });
        assert.equal(changed.statusCode, 200, changed.body);
        assert.equal((await travel(original)).statusCode, 409);
      }
      const original = await create("completion conflict");
      const completed = await app.inject({ method: "PATCH", url: `/api/annotations/${original.id}/completion`, headers: headers("reviewer"), payload: { completed: true, expectedUpdatedAt: original.updatedAt } });
      assert.equal(completed.statusCode, 200, completed.body);
      assert.equal((await travel(original)).statusCode, 409);
      assert.equal((await active(original.id))?.completedById, "reviewer");
    });

    await t.test("tampering, cross-user replay, lost annotate access and cross-media paths are rejected", async () => {
      const original = await create("owned", {}, "reviewer");
      assert.equal((await travel(original, "owner")).statusCode, 403);
      assert.equal((await travel({ ...original, historyToken: `${original.historyToken}x` }, "reviewer")).statusCode, 400);
      assert.equal((await travel(original, "outsider")).statusCode, 403);
      await prisma.mediaPermissionGrant.deleteMany({ where: { mediaId: "media", subjectUserId: "reviewer" } });
      assert.equal((await travel(original, "reviewer")).statusCode, 403);
      assert.equal((await app.inject({ method: "PATCH", url: `/api/annotations/${original.id}`, headers: headers("reviewer"), payload: { body: "not permitted" } })).statusCode, 403);
      assert.equal((await app.inject({ method: "DELETE", url: `/api/annotations/${original.id}`, headers: headers("reviewer") })).statusCode, 403);
      await prisma.mediaPermissionGrant.create({ data: { mediaId: "media", subjectType: "invited_user", subjectKey: "reviewer", subjectUserId: "reviewer", permission: "annotate" } });
      const wrongPath = await app.inject({ method: "POST", url: "/api/annotations/not-this-annotation/history", headers: headers("reviewer"), payload: { historyToken: original.historyToken } });
      assert.equal(wrongPath.statusCode, 400);
    });

    await t.test("share history persists for a signed guest and rejects forged guest IDs and revoked/view-only links", async () => {
      const link = await prisma.shareLink.create({ data: { id: "share-link", tokenHash: "unused-history-hash", projectId: "project", mediaId: "media", audience: "anyone", permissions: { create: { permission: "annotate" } } } });
      const url = `/api/share/${link.id}/annotations`;
      const created = await app.inject({ method: "POST", url, payload: { timestampMs: 2000, type: "text", body: "guest original" } });
      assert.equal(created.statusCode, 201, created.body);
      const entry = created.json<Mutation>();
      const guestCookie = created.cookies.find((value) => value.name === "mr_share_guest");
      assert.ok(guestCookie);
      const guestHeaders = { cookie: `mr_share_guest=${guestCookie.value}` };
      const historyUrl = `${url}/${entry.id}/history`;
      const forged = await app.inject({ method: "POST", url: historyUrl, headers: { cookie: `mr_share_guest=${(await active(entry.id))!.authorId}` }, payload: { historyToken: entry.historyToken } });
      assert.equal(forged.statusCode, 403, forged.body);
      const undo = await app.inject({ method: "POST", url: historyUrl, headers: guestHeaders, payload: { historyToken: entry.historyToken } });
      assert.equal(undo.statusCode, 200, undo.body);
      assert.equal(await active(entry.id), null);
      const redo = await app.inject({ method: "POST", url: historyUrl, headers: guestHeaders, payload: { historyToken: undo.json().historyToken } });
      assert.equal(redo.statusCode, 200, redo.body);
      assert.equal((await active(entry.id))?.body, "guest original");
      await prisma.shareLinkPermission.updateMany({ where: { shareLinkId: link.id }, data: { permission: "view" } });
      assert.equal((await app.inject({ method: "POST", url: historyUrl, headers: guestHeaders, payload: { historyToken: redo.json().historyToken } })).statusCode, 403);
      await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
      assert.equal((await app.inject({ method: "POST", url: historyUrl, headers: guestHeaders, payload: { historyToken: redo.json().historyToken } })).statusCode, 410);
    });

    await t.test("authenticated shares reject anonymous reads and history mutations", async () => {
      await prisma.shareLink.create({ data: { id: "authenticated-share", tokenHash: "authenticated-history-hash", projectId: "project", mediaId: "media", audience: "authenticated", permissions: { create: { permission: "annotate" } } } });
      const response = await app.inject({ method: "GET", url: "/api/share/authenticated-share/annotations" });
      assert.equal(response.statusCode, 401, response.body);
      const loggedIn = await app.inject({ method: "GET", url: "/api/share/authenticated-share/annotations", headers: headers() });
      assert.equal(loggedIn.statusCode, 200, loggedIn.body);
    });

    await t.test("a maxUses=1 visit can annotate and undo without admitting another browser", async () => {
      const token = "limited-history-token";
      await prisma.shareLink.create({ data: { id: "limited-history", tokenHash: sha256Hex(token), projectId: "project", mediaId: "media", audience: "anyone", maxUses: 1, permissions: { create: { permission: "annotate" } } } });
      const base = `/api/share/${token}`;
      const entry = await app.inject({ method: "GET", url: `${base}/media` });
      assert.equal(entry.statusCode, 200, entry.body);
      const visit = entry.cookies.find((value) => value.name.startsWith("mr_export_visit_"));
      assert.ok(visit);
      const visitCookie = `${visit.name}=${visit.value}`;
      assert.equal((await app.inject({ method: "GET", url: `${base}/annotations`, headers: { cookie: visitCookie } })).statusCode, 200);
      const created = await app.inject({ method: "POST", url: `${base}/annotations`, headers: { cookie: visitCookie }, payload: { timestampMs: 0, type: "text", body: "same visit" } });
      assert.equal(created.statusCode, 201, created.body);
      const guest = created.cookies.find((value) => value.name === "mr_share_guest");
      assert.ok(guest);
      const annotation = created.json<Mutation>();
      const undo = await app.inject({ method: "POST", url: `${base}/annotations/${annotation.id}/history`, headers: { cookie: `${visitCookie}; mr_share_guest=${guest.value}` }, payload: { historyToken: annotation.historyToken } });
      assert.equal(undo.statusCode, 200, undo.body);
      assert.equal((await app.inject({ method: "GET", url: `${base}/media`, headers: { cookie: visitCookie } })).statusCode, 200);
      assert.equal((await prisma.shareLink.findUniqueOrThrow({ where: { id: "limited-history" } })).useCount, 1);
      assert.equal((await app.inject({ method: "GET", url: `${base}/annotations` })).statusCode, 410);
      await prisma.shareLink.update({ where: { id: "limited-history" }, data: { revokedAt: new Date() } });
      assert.equal((await app.inject({ method: "GET", url: `${base}/annotations`, headers: { cookie: visitCookie } })).statusCode, 410);
    });
  } finally {
    await app.close();
    await prisma.$disconnect();
    rmSync(dbPath, { force: true });
    rmSync(`${dbPath}-journal`, { force: true });
  }
});
