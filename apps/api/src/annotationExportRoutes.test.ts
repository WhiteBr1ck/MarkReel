import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import test, { before, after } from "node:test";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { setupMediaSeriesTestSchema } from "./mediaSeriesFixtures";
import type { AnnotationExportJob } from "./annotationExportJobs";

const execFileAsync = promisify(execFile);
let directory: string;
let prisma: typeof import("./db")["prisma"];
let app: FastifyInstance;
let ownerCookie: string;
let viewerCookie: string;
let outsiderCookie: string;
let image: Buffer;
let video: Buffer;
let ffmpegAvailable = false;
let objectReads = 0;
const originalRanges: string[] = [];
let holdAttachment = false;
const objects = new Map<string, Buffer>();
const sockets = new Set<import("node:net").Socket>();
const storage = http.createServer((req, res) => {
  const pathname = new URL(req.url!, "http://localhost").pathname;
  const target = objects.get(pathname);
  if (!target) { res.writeHead(404, { "content-type": "application/xml" }); res.end("<Error><Code>NoSuchKey</Code></Error>"); return; }
  objectReads += 1;
  if (pathname.startsWith("/original/") && req.headers.range) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    const start = range ? Number(range[1]) : target.length;
    const end = range?.[2] ? Math.min(Number(range[2]), target.length - 1) : target.length - 1;
    if (start > end || start >= target.length) { res.writeHead(416, { "content-range": `bytes */${target.length}` }); res.end(); return; }
    originalRanges.push(req.headers.range);
    res.writeHead(206, { "content-type": "video/mp4", "accept-ranges": "bytes", "content-length": end - start + 1,
      "content-range": `bytes ${start}-${end}/${target.length}` });
    res.end(target.subarray(start, end + 1));
    return;
  }
  res.writeHead(200, { "content-type": "application/octet-stream", "content-length": target.length, etag: '"export-test"' });
  if (holdAttachment && req.url!.includes("hold")) { res.flushHeaders(); return; }
  res.end(target);
});
storage.on("connection", (socket) => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); });

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "markreel-export-test-"));
  await new Promise<void>((resolve) => storage.listen(0, "127.0.0.1", resolve));
  const address = storage.address() as import("node:net").AddressInfo;
  Object.assign(process.env, {
    MARKREEL_ENV_FILE: path.join(directory, "no-env"), MARKREEL_STORE: "sqlite", MARKREEL_SKIP_BOOTSTRAP: "true",
    DATABASE_URL: `file:${path.join(directory, "exports.db").replace(/\\/g, "/")}`,
    JWT_ACCESS_SECRET: "export_access_secret_123456789", JWT_REFRESH_SECRET: "export_refresh_secret_123456789",
    JWT_AUTH_INSTANCE_ID: "export-test-instance", S3_ENDPOINT: `http://127.0.0.1:${address.port}`, S3_REGION: "us-east-1",
    S3_ACCESS_KEY: "test", S3_SECRET_KEY: "test", S3_BUCKET_ORIGINAL: "original", S3_BUCKET_DERIVED: "derived", S3_BUCKET_ATTACHMENTS: "attachments"
  });
  delete process.env.REDIS_URL;
  ({ prisma } = await import("./db"));
  await setupMediaSeriesTestSchema(prisma);
  await prisma.user.createMany({ data: ["owner", "viewer", "outsider"].map((id) => ({ id, username: `export_${id}`, passwordHash: "unused" })) });
  await prisma.project.createMany({ data: [{ id: "project", name: "Exports", ownerId: "owner" }, { id: "other", name: "Other", ownerId: "outsider" }] });
  await prisma.projectMember.create({ data: { projectId: "project", userId: "viewer", role: "viewer" } });
  await prisma.media.createMany({ data: [{ id: "media", title: "=Untrusted title", projectId: "project", creatorId: "owner", versionIndex: 3 },
    { id: "other-media", title: "Other", projectId: "other", creatorId: "outsider" }] });
  await prisma.annotation.createMany({ data: [
    { id: "root", projectId: "project", mediaId: "media", authorId: "owner", type: "text", timestampMs: 100, body: "=HYPERLINK(\"bad\")" },
    { id: "done", projectId: "project", mediaId: "media", authorId: "owner", type: "pin", timestampMs: 200, body: "Completed note", completedAt: new Date() },
    { id: "reply", parentId: "root", projectId: "project", mediaId: "media", authorId: "viewer", type: "text", timestampMs: 300, body: "@reply" },
    { id: "deleted", projectId: "project", mediaId: "media", authorId: "owner", type: "text", timestampMs: 300, body: "secret", deletedAt: new Date() },
    { id: "other-root", projectId: "other", mediaId: "other-media", authorId: "outsider", type: "text", timestampMs: 100, body: "other secret" }
  ] });
  await prisma.attachment.createMany({ data: [
    { id: "first", annotationId: "root", kind: "image", objectKey: "attachments/a/same.png" },
    { id: "second", annotationId: "reply", kind: "image", objectKey: "attachments/b/same.png" },
    { id: "broken", annotationId: "root", kind: "image", objectKey: "attachments/missing.png" },
    { id: "deleted-file", annotationId: "deleted", kind: "image", objectKey: "attachments/deleted.png" },
    { id: "other-file", annotationId: "other-root", kind: "image", objectKey: "attachments/other.png" }
  ] });
  image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=", "base64");
  try {
    const videoPath = path.join(directory, "source.mp4");
    await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10", "-t", "1", "-c:v", "mpeg4", videoPath], { windowsHide: true, timeout: 30000 });
    const imagePath = path.join(directory, "picture.png");
    await execFileAsync("ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=c=green:s=160x90", "-frames:v", "1", imagePath], { windowsHide: true, timeout: 30000 });
    image = await readFile(imagePath);
    video = await readFile(videoPath);
    objects.set("/original/video.mp4", video);
    ffmpegAvailable = true;
  } catch { /* Image and ZIP authorization tests still run without a local ffmpeg binary. */ }
  objects.set("/attachments/attachments/a/same.png", image);
  objects.set("/attachments/attachments/b/same.png", image);
  objects.set("/attachments/attachments/other.png", image);
  await prisma.mediaFile.create({ data: { id: "file", mediaId: "media", originalObjectKey: "video.mp4", mode: "original", sizeBytes: 14n * 1024n * 1024n * 1024n, durationMs: 1000 } });
  app = Fastify();
  await app.register(cookie);
  await (await import("./auth/tokens")).registerJwt(app);
  await app.register(async (scope) => {
    await (await import("./routes/shareLinks")).shareLinkRoutes(scope);
    await (await import("./routes/annotationExports")).annotationExportRoutes(scope);
  }, { prefix: "/api" });
  await app.ready();
  const auth = (sub: string) => `mr_access=${app.jwt.sign({ sub, sv: 1, si: "export-test-instance" })}`;
  ownerCookie = auth("owner"); viewerCookie = auth("viewer"); outsiderCookie = auth("outsider");
});

after(async () => {
  await app?.close();
  await prisma?.$disconnect();
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => storage.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

const base = "/api/media/media/annotation-exports";
async function create(payload: object, cookieValue = ownerCookie, url = base) {
  const response = await app.inject({ method: "POST", url, headers: { cookie: cookieValue }, payload });
  assert.equal(response.statusCode, 202, response.body);
  return response.json().export as AnnotationExportJob;
}
async function waitForJob(id: string, cookieValue = ownerCookie, url = base) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const response = await app.inject({ url: `${url}/${id}`, headers: { cookie: cookieValue } });
    assert.equal(response.statusCode, 200, response.body);
    const job = response.json().export as AnnotationExportJob;
    if (!["queued", "running"].includes(job.state)) return job;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("export_did_not_settle");
}

test("single original download preserves bytes and denies anonymous, other-media and deleted attachments", async () => {
  const url = "/api/media/media/annotations/root/attachments/first/download";
  const response = await app.inject({ url, headers: { cookie: viewerCookie } });
  assert.equal(response.statusCode, 200, response.body);
  assert.deepEqual(response.rawPayload, image);
  assert.match(String(response.headers["content-disposition"]), /^attachment;/);
  assert.equal(response.headers["cache-control"], "private, no-store");
  assert.equal((await app.inject({ url })).statusCode, 401);
  assert.equal((await app.inject({ url, headers: { cookie: outsiderCookie } })).statusCode, 404);
  assert.equal((await app.inject({ url: url.replace("first", "other-file"), headers: { cookie: viewerCookie } })).statusCode, 404);
  assert.equal((await app.inject({ url: url.replace("root/attachments/first", "deleted/attachments/deleted-file"), headers: { cookie: ownerCookie } })).statusCode, 404);
});

test("thread ZIP contains duplicate-safe originals and per-attachment failure manifest", async () => {
  const job = await create({ format: "zip", annotationId: "root" }, viewerCookie);
  const done = await waitForJob(job.id, viewerCookie);
  assert.equal(done.state, "completed");
  assert.equal(done.warnings.length, 1);
  assert.equal(done.warnings[0].attachmentId, "broken");
  const response = await app.inject({ url: `${base}/${job.id}/file`, headers: { cookie: viewerCookie } });
  assert.equal(response.statusCode, 200);
  const zip = await JSZip.loadAsync(response.rawPayload);
  const manifest = JSON.parse(await zip.file("manifest.json")!.async("string"));
  assert.equal(manifest.entries.length, 3);
  assert.equal(new Set(manifest.entries.map((entry: { filename: string }) => entry.filename)).size, 3);
  for (const entry of manifest.entries.filter((entry: { status: string }) => entry.status === "exported")) {
    assert.deepEqual(await zip.file(entry.filename)!.async("nodebuffer"), image);
  }
  assert.ok(!JSON.stringify(manifest).includes("objectKey"));
  assert.equal((await app.inject({ url: `${base}/${job.id}`, headers: { cookie: ownerCookie } })).statusCode, 404);
});

test("XLSX seeks frames from 14 GiB source metadata via HTTP Range, merges replies and writes no formulas", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const job = await create({ format: "xlsx" });
  const done = await waitForJob(job.id);
  assert.equal(done.state, "completed", JSON.stringify(done));
  const response = await app.inject({ url: `${base}/${job.id}/file`, headers: { cookie: ownerCookie } });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.rawPayload as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.rowCount, 3);
  assert.equal(sheet.getCell("D2").value, "'=HYPERLINK(\"bad\")");
  assert.ok(String(sheet.getCell("I2").value).includes("export_viewer: @reply"));
  assert.equal(sheet.getCell("F3").value, "已完成");
  assert.equal(sheet.getCell("C2").value, "00:00:00.100");
  assert.equal(sheet.getImages().length, 4);
  assert.ok(originalRanges.length >= 2, "uncached video frames must use HTTP Range, not whole-video staging");
  assert.deepEqual(done.warnings.map((warning) => warning.attachmentId), ["broken"]);
  const archive = await JSZip.loadAsync(response.rawPayload);
  const xml = await archive.file("xl/worksheets/sheet1.xml")!.async("string");
  assert.ok(!xml.includes("<f>"));
  const beforeReads = objectReads;
  const next = await create({ format: "xlsx", status: "completed" });
  const nextDone = await waitForJob(next.id);
  assert.equal(nextDone.state, "completed");
  assert.equal(objectReads, beforeReads, "cached frame must not fetch the original source again");
});

test("frame endpoint shares XLSX cache and validates permission and duration before cached bytes", async (t) => {
  if (!ffmpegAvailable) return t.skip("ffmpeg unavailable");
  const url = "/api/media/media/frame?timestampMs=100";
  const beforeReads = objectReads;
  const cached = await app.inject({ url, headers: { cookie: viewerCookie } });
  assert.equal(cached.statusCode, 200, cached.body);
  assert.equal(cached.headers["content-type"], "image/jpeg");
  assert.equal(cached.headers["x-frame-width"], "640");
  assert.equal(cached.headers["x-frame-height"], "360");
  assert.equal(cached.headers["x-frame-timestamp-ms"], "100");
  assert.deepEqual(cached.rawPayload.subarray(0, 2), Buffer.from([0xff, 0xd8]));
  assert.equal(objectReads, beforeReads, "MCP and XLSX must reuse the same cached frame");
  assert.equal((await app.inject({ url })).statusCode, 401);
  assert.equal((await app.inject({ url, headers: { cookie: outsiderCookie } })).statusCode, 404);
  for (const timestamp of ["-1", "1.5", "NaN", "", "1e2"]) assert.equal((await app.inject({ url: `/api/media/media/frame?timestampMs=${timestamp}`, headers: { cookie: ownerCookie } })).statusCode, 400);
  assert.equal((await app.inject({ url: "/api/media/media/frame?timestampMs=1000", headers: { cookie: viewerCookie } })).statusCode, 422);
  await prisma.mediaFile.update({ where: { id: "file" }, data: { durationMs: 100 } });
  assert.equal((await app.inject({ url, headers: { cookie: viewerCookie } })).statusCode, 422, "a newly out-of-bounds cached frame must be rejected");
  await prisma.mediaFile.update({ where: { id: "file" }, data: { durationMs: null } });
  assert.equal((await app.inject({ url, headers: { cookie: viewerCookie } })).statusCode, 409);
  await prisma.mediaFile.update({ where: { id: "file" }, data: { durationMs: 1000 } });
  const uncachedUrl = "/api/media/media/frame?timestampMs=400";
  const original = await app.inject({ url: uncachedUrl, headers: { cookie: viewerCookie } });
  assert.equal(original.statusCode, 200, original.body);
  assert.ok(objectReads > beforeReads, "uncached frame is extracted via a real internal S3 URL");
  const afterReads = objectReads;
  const repeated = await app.inject({ url: uncachedUrl, headers: { cookie: ownerCookie } });
  assert.deepEqual(repeated.rawPayload, original.rawPayload);
  assert.equal(objectReads, afterReads);
});

test("share export enforces token, media scope, audience, password and rechecks revocation", async () => {
  const { sha256Hex } = await import("./share");
  const { hashPassword } = await import("./auth/password");
  const token = "secret-export-share";
  const link = await prisma.shareLink.create({ data: {
    tokenHash: sha256Hex(token), mediaId: "media", projectId: "project", createdById: "owner",
    audience: "authenticated", passwordHash: await hashPassword("password123"), permissions: { create: { permission: "view" } }
  } });
  const share = `/api/share/${token}/media/media/annotation-exports`;
  assert.equal((await app.inject({ method: "POST", url: share, payload: { format: "zip" } })).statusCode, 401);
  assert.equal((await app.inject({ method: "POST", url: share, headers: { cookie: viewerCookie }, payload: { format: "zip" } })).statusCode, 401);
  const headers = { cookie: viewerCookie, "x-markreel-share-password": "password123" };
  assert.equal((await app.inject({ method: "POST", url: share.replace(token, link.id), headers, payload: { format: "zip" } })).statusCode, 404);
  assert.equal((await app.inject({ method: "POST", url: share.replace("/media/media/", "/media/other-media/"), headers, payload: { format: "zip" } })).statusCode, 404);
  const response = await app.inject({ method: "POST", url: share, headers, payload: { format: "zip", status: "completed" } });
  assert.equal(response.statusCode, 202, response.body);
  const proofCookie = response.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
  const cookies = `${viewerCookie}; ${proofCookie}`;
  const job = response.json().export as AnnotationExportJob;
  assert.equal((await waitForJob(job.id, cookies, share)).state, "completed");
  assert.equal((await app.inject({ url: `${share}/${job.id}/file`, headers: { cookie: cookies } })).statusCode, 200);
  await prisma.shareLink.update({ where: { id: link.id }, data: { passwordHash: await hashPassword("changed-password") } });
  for (const suffix of [`/${job.id}`, `/${job.id}/file`]) {
    const oldProof = await app.inject({ url: `${share}${suffix}`, headers: { cookie: cookies } });
    assert.equal(oldProof.statusCode, 401);
    assert.equal(oldProof.json().error, "invalid_share_password");
    assert.equal((await app.inject({ url: `${share}${suffix}`, headers: { ...headers, cookie: cookies } })).statusCode, 401);
  }
  await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
  for (const suffix of [`/${job.id}`, `/${job.id}/file`]) assert.equal((await app.inject({ url: `${share}${suffix}`, headers: { cookie: cookies } })).statusCode, 410);
});

test("maxUses=1 media entry admits exports and assets for that visit, not fresh browsers or forged proofs", async (t) => {
  const { sha256Hex } = await import("./share");
  const token = "single-media-visit";
  const link = await prisma.shareLink.create({ data: { tokenHash: sha256Hex(token), projectId: "project", mediaId: "media",
    maxUses: 1, permissions: { create: { permission: "view" } } } });
  const share = `/api/share/${token}/media/media/annotation-exports`;
  const entry = await app.inject({ url: `/api/share/${token}/media` });
  assert.equal(entry.statusCode, 200, entry.body);
  assert.equal((await prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } })).useCount, 1);
  const visit = entry.cookies.find((value) => value.name.startsWith("mr_export_visit_"));
  assert.ok(visit, "the successful entry must mint an admission proof after counting the visit");
  const cookies = `${visit.name}=${visit.value}`;
  const job = await create({ format: "zip", status: "completed" }, cookies, share);
  assert.equal((await waitForJob(job.id, cookies, share)).state, "completed");
  assert.equal((await app.inject({ url: `${share}/${job.id}/file`, headers: { cookie: cookies } })).statusCode, 200);
  assert.equal((await app.inject({ url: `/api/share/${token}/media/media/annotations/root/attachments/first/download`, headers: { cookie: cookies } })).statusCode, 200);
  if (ffmpegAvailable) assert.equal((await app.inject({ url: `/api/share/${token}/media/media/frame?timestampMs=100`, headers: { cookie: cookies } })).statusCode, 200);
  assert.equal((await prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } })).useCount, 1, "export operations must not consume more visits");
  const invalidCookies = ["", `mr_share_guest=${app.jwt.sign({ sub: "viewer", purpose: "share_guest", si: "export-test-instance" })}`,
    `${visit.name}=${visit.value.slice(0, -1)}${visit.value.endsWith("0") ? "1" : "0"}`];
  for (const cookieValue of invalidCookies) {
    const response = await app.inject({ url: `${share}/${job.id}/file`, headers: { cookie: cookieValue } });
    assert.equal(response.statusCode, 410);
    assert.equal(response.json().error, "max_uses_reached");
  }
  const secondToken = "another-exhausted-visit";
  const secondLink = await prisma.shareLink.create({ data: { tokenHash: sha256Hex(secondToken), projectId: "project", mediaId: "media",
    maxUses: 1, useCount: 1, permissions: { create: { permission: "view" } } } });
  const secondCookieName = `mr_export_visit_${sha256Hex(secondLink.id).slice(0, 16)}`;
  assert.equal((await app.inject({ method: "POST", url: share.replace(token, secondToken), headers: { cookie: `${secondCookieName}=${visit.value}` }, payload: { format: "zip" } })).statusCode, 410);
  const now = Date.now();
  t.mock.method(Date, "now", () => now + 31 * 60 * 1000);
  try {
    const expired = await app.inject({ url: `${share}/${job.id}/file`, headers: { cookie: cookies } });
    assert.equal(expired.statusCode, 410);
    assert.equal(expired.json().error, "max_uses_reached");
  } finally { t.mock.restoreAll(); }
  await prisma.shareLink.update({ where: { id: link.id }, data: { revokedAt: new Date() } });
  assert.equal((await app.inject({ url: `${share}/${job.id}/file`, headers: { cookie: cookies } })).json().error, "revoked");
});

test("maxUses=1 project access entry proof survives consumed count but is invalidated by password changes", async () => {
  const { sha256Hex } = await import("./share");
  const { hashPassword } = await import("./auth/password");
  const token = "single-project-visit";
  const link = await prisma.shareLink.create({ data: { tokenHash: sha256Hex(token), projectId: "project", maxUses: 1,
    permissions: { create: { permission: "view" } } } });
  const entry = await app.inject({ method: "POST", url: `/api/share/${token}/access`, payload: {} });
  assert.equal(entry.statusCode, 200, entry.body);
  const cookies = entry.cookies.map((value) => `${value.name}=${value.value}`).join("; ");
  assert.ok(cookies.includes("mr_export_visit_"));
  const share = `/api/share/${token}/media/media/annotation-exports`;
  const job = await create({ format: "zip", status: "completed" }, cookies, share);
  await waitForJob(job.id, cookies, share);
  await prisma.shareLink.update({ where: { id: link.id }, data: { passwordHash: await hashPassword("new-share-password") } });
  assert.equal((await app.inject({ url: `${share}/${job.id}/file`, headers: { cookie: cookies } })).statusCode, 401);
  assert.equal((await app.inject({ url: `${share}/${job.id}/file`, headers: { cookie: cookies, "x-markreel-share-password": "new-share-password" } })).statusCode, 410,
    "a changed password invalidates the previous visit even after password re-verification");
});

test("direct limited-share exports count one visit atomically and reuse it for polling and download", async () => {
  const { sha256Hex } = await import("./share");
  const token = "direct-single-export-visit";
  const link = await prisma.shareLink.create({ data: { tokenHash: sha256Hex(token), mediaId: "media", projectId: "project", maxUses: 1,
    permissions: { create: { permission: "view" } } } });
  const share = `/api/share/${token}/media/media/annotation-exports`;
  const responses = await Promise.all([0, 1].map(() => app.inject({ method: "POST", url: share, payload: { format: "zip", status: "completed" } })));
  assert.deepEqual(responses.map((value) => value.statusCode).sort(), [202, 410]);
  const admitted = responses.find((value) => value.statusCode === 202)!;
  const cookies = admitted.cookies.map((value) => `${value.name}=${value.value}`).join("; ");
  const job = admitted.json().export as AnnotationExportJob;
  assert.equal((await waitForJob(job.id, cookies, share)).state, "completed");
  assert.equal((await app.inject({ url: `${share}/${job.id}/file`, headers: { cookie: cookies } })).statusCode, 200);
  assert.equal((await prisma.shareLink.findUniqueOrThrow({ where: { id: link.id } })).useCount, 1);
});

test("anonymous project shares are scoped and expiration and removed permissions are enforced", async () => {
  const { sha256Hex } = await import("./share");
  const token = "project-export-share";
  const link = await prisma.shareLink.create({ data: { tokenHash: sha256Hex(token), projectId: "project", audience: "anyone", permissions: { create: { permission: "view" } } } });
  const share = `/api/share/${token}/media/media/annotation-exports`;
  const job = await create({ format: "zip", status: "completed" }, "", share);
  assert.equal((await waitForJob(job.id, "", share)).state, "completed");
  assert.equal((await app.inject({ url: `/api/share/${token}/media/media/annotations/root/attachments/first/download` })).statusCode, 200);
  assert.equal((await app.inject({ method: "POST", url: share.replace("/media/media/", "/media/other-media/"), payload: { format: "zip" } })).statusCode, 404);
  await prisma.shareLink.update({ where: { id: link.id }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await app.inject({ url: `${share}/${job.id}/file` })).statusCode, 410);
  await prisma.shareLink.update({ where: { id: link.id }, data: { expiresAt: null } });
  await prisma.shareLinkPermission.deleteMany({ where: { shareLinkId: link.id } });
  assert.equal((await app.inject({ url: `${share}/${job.id}` })).statusCode, 403);
});

test("ordinary access revocation immediately blocks progress, cancellation and generated file", async () => {
  const job = await create({ format: "zip", status: "completed" }, viewerCookie);
  await waitForJob(job.id, viewerCookie);
  await prisma.projectMember.delete({ where: { projectId_userId: { projectId: "project", userId: "viewer" } } });
  try {
    for (const suffix of [`/${job.id}`, `/${job.id}/file`]) assert.equal((await app.inject({ url: `${base}${suffix}`, headers: { cookie: viewerCookie } })).statusCode, 404);
    assert.equal((await app.inject({ method: "DELETE", url: `${base}/${job.id}`, headers: { cookie: viewerCookie } })).statusCode, 404);
  } finally {
    await prisma.projectMember.create({ data: { projectId: "project", userId: "viewer", role: "viewer" } });
  }
});

test("resource limits are applied before allocating oversized annotation and attachment exports", async () => {
  await prisma.media.create({ data: { id: "quota-media", title: "Quota", projectId: "project", creatorId: "owner" } });
  await prisma.annotation.createMany({ data: Array.from({ length: 201 }, (_, index) => ({ id: `quota-${index}`, projectId: "project", mediaId: "quota-media", authorId: "owner", type: "text", timestampMs: index, body: "note" })) });
  const url = "/api/media/quota-media/annotation-exports";
  assert.equal((await app.inject({ method: "POST", url, headers: { cookie: ownerCookie }, payload: { format: "xlsx" } })).json().error, "row_resource_limit");
  await prisma.attachment.createMany({ data: Array.from({ length: 301 }, (_, index) => ({ annotationId: "quota-0", kind: "image", objectKey: `attachments/quota-${index}.png` })) });
  const attachments = await app.inject({ method: "POST", url, headers: { cookie: ownerCookie }, payload: { format: "zip", annotationId: "quota-0" } });
  assert.equal(attachments.statusCode, 413);
  assert.equal(attachments.json().error, "attachment_resource_limit");
});

test("completed jobs retain only the result and cancellation or expiry removes the temporary directory", async () => {
  const { AnnotationExportJobs } = await import("./annotationExportJobs");
  const jobs = new AnnotationExportJobs();
  try {
    const job = await jobs.create("test", { media: { id: "empty", title: "Empty", versionIndex: 1, file: null }, annotations: [] }, { format: "zip", status: "all" });
    await job.settled;
    assert.equal(job.state, "completed");
    assert.deepEqual(await readdir(job.directory!), ["attachments.zip"]);
    await jobs.cancel(job);
    await assert.rejects(stat(job.directory!), { code: "ENOENT" });
    const expiring = await jobs.create("test", { media: { id: "empty", title: "Empty", versionIndex: 1, file: null }, annotations: [] }, { format: "zip", status: "all" });
    await expiring.settled;
    expiring.expiresAt = Date.now() - 1;
    assert.equal(await jobs.find(expiring.id, "test", "empty"), null);
    await assert.rejects(stat(expiring.directory!), { code: "ENOENT" });
  } finally { await jobs.close(); }
});

test("validation, task limits and cancellation stop an active object read", async () => {
  assert.equal((await app.inject({ method: "POST", url: base, headers: { cookie: ownerCookie }, payload: { format: "csv" } })).statusCode, 400);
  assert.equal((await app.inject({ method: "POST", url: base, headers: { cookie: ownerCookie }, payload: { format: "zip", annotationId: "other-root" } })).statusCode, 404);
  const { ANNOTATION_EXPORT_LIMITS } = await import("./annotationExport");
  objects.set("/attachments/attachments/huge.png", Buffer.alloc(ANNOTATION_EXPORT_LIMITS.attachmentBytes + 1));
  await prisma.attachment.create({ data: { id: "huge", annotationId: "done", kind: "image", objectKey: "attachments/huge.png" } });
  const huge = await app.inject({ url: "/api/media/media/annotations/done/attachments/huge/download", headers: { cookie: ownerCookie } });
  assert.equal(huge.statusCode, 413);
  await prisma.attachment.delete({ where: { id: "huge" } });
  objects.set("/attachments/attachments/hold.png", image);
  await prisma.attachment.create({ data: { id: "hold", annotationId: "done", kind: "image", objectKey: "attachments/hold.png" } });
  holdAttachment = true;
  const first = await create({ format: "zip", annotationId: "done" });
  const second = await create({ format: "zip", annotationId: "done" });
  assert.equal((await app.inject({ method: "POST", url: base, headers: { cookie: ownerCookie }, payload: { format: "zip" } })).statusCode, 429);
  assert.equal((await app.inject({ url: `${base}/${first.id}/file`, headers: { cookie: ownerCookie } })).statusCode, 409);
  for (const job of [first, second]) {
    const result = await app.inject({ method: "DELETE", url: `${base}/${job.id}`, headers: { cookie: ownerCookie } });
    assert.equal(result.statusCode, 200, result.body);
    assert.equal(result.json().export.state, "cancelled");
    assert.equal((await app.inject({ url: `${base}/${job.id}/file`, headers: { cookie: ownerCookie } })).statusCode, 409);
  }
  holdAttachment = false;
});
