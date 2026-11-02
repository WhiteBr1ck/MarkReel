import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { ApiError, MarkReelClient } from "./client.js";
import { readConfig } from "./config.js";
import { UploadError, uploadVideo } from "./upload.js";

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function fixture() {
  const state = { logins: 0, refreshes: 0, access: "access1", creates: 0, processStatus: 200, directStatus: 503, rejectEarly: false,
    uploads: [] as Buffer[], storageCookies: [] as Array<string | undefined>, processBodies: [] as unknown[] };
  const storage = createServer((req, res) => {
    state.storageCookies.push(req.headers.cookie);
    if (req.method === "HEAD") { res.end(); return; }
    if (state.rejectEarly) { req.resume(); res.writeHead(503); res.end(); return; }
    void body(req).then((bytes) => { state.uploads.push(bytes); res.writeHead(state.directStatus); res.end(); });
  });
  storage.listen(0, "127.0.0.1");
  await once(storage, "listening");
  const storageAddress = storage.address();
  assert.ok(storageAddress && typeof storageAddress !== "string");
  const api = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname === "/api/auth/login") {
        state.logins += 1;
        assert.deepEqual(JSON.parse((await body(req)).toString()), { username: "mcp_test", password: "password123" });
        res.setHeader("set-cookie", [`mr_access=${state.access}; Path=/; HttpOnly`, "mr_refresh=refresh1; Path=/api/auth/refresh; HttpOnly"]);
        json(res, { user: { id: "user1" } }); return;
      }
      if (url.pathname === "/api/auth/refresh") {
        state.refreshes += 1;
        assert.equal(req.headers.cookie, "mr_refresh=refresh1");
        res.setHeader("set-cookie", `mr_access=${state.access}; Path=/; HttpOnly`);
        json(res, { ok: true }); return;
      }
      if (req.headers.cookie !== `mr_access=${state.access}` && req.headers.authorization !== `Bearer mr_token_${"a".repeat(43)}`) { json(res, { error: "unauthorized" }, 401); return; }
      if (url.pathname === "/api/forbidden") { json(res, { error: "forbidden" }, 403); return; }
      if (url.pathname === "/api/projects/p1/media") {
        const input = JSON.parse((await body(req)).toString()) as { sourceMediaId?: unknown };
        if (input.sourceMediaId !== undefined && typeof input.sourceMediaId !== "string") { json(res, { error: "validation_error" }, 400); return; }
        state.creates += 1;
        json(res, { media: { id: "m1", title: "video" } }, 201); return;
      }
      if (url.pathname === "/api/media/m1/upload/presign") {
        json(res, { upload: { objectKey: "original/m1/key.mov", url: `http://127.0.0.1:${storageAddress.port}/video?X-Amz-Signature=test` } }); return;
      }
      if (url.pathname === "/api/media/m1/upload/file") {
        assert.equal(url.searchParams.get("objectKey"), "original/m1/key.mov");
        const bytes = await body(req);
        assert.equal(Number(req.headers["content-length"]), bytes.byteLength);
        state.uploads.push(bytes);
        json(res, { ok: true }); return;
      }
      if (url.pathname === "/api/media/m1/process") {
        state.processBodies.push(JSON.parse((await body(req)).toString()));
        json(res, state.processStatus === 200 ? { ok: true, queued: false } : { error: "processing_failed" }, state.processStatus); return;
      }
      json(res, { ok: true });
    })().catch((error) => { json(res, { error: "fixture_error" }, 500); queueMicrotask(() => { throw error; }); });
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const address = api.address();
  assert.ok(address && typeof address !== "string");
  const config = readConfig({ MARKREEL_MCP_BASE_URL: `http://127.0.0.1:${address.port}`, MARKREEL_MCP_USERNAME: "mcp_test", MARKREEL_MCP_PASSWORD: "password123" });
  return { state, config, client: new MarkReelClient(config), close: async () => {
    api.closeAllConnections(); storage.closeAllConnections();
    await Promise.all([new Promise<void>((resolve) => api.close(() => resolve())), new Promise<void>((resolve) => storage.close(() => resolve()))]);
  } };
}

test("coalesces login and refresh, preserves authorization errors, and blocks writes in read-only mode", async () => {
  const f = await fixture();
  try {
    await Promise.all([f.client.request("/me"), f.client.request("/projects")]);
    assert.equal(f.state.logins, 1);
    f.state.access = "access2";
    await Promise.all([f.client.request("/me"), f.client.request("/projects")]);
    assert.equal(f.state.refreshes, 1);
    assert.equal(f.state.logins, 1);
    await assert.rejects(f.client.request("/forbidden"), (error: unknown) => error instanceof ApiError && error.status === 403 && error.code === "forbidden");
    const readonlyClient = new MarkReelClient({ ...f.config, readOnly: true });
    await assert.rejects(readonlyClient.request("/projects", { method: "POST", body: { name: "no" } }), /read-only/);
  } finally { await f.close(); }
});

test("streams a MOV, falls back from storage to API, and returns recoverable processing failures", async () => {
  const f = await fixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), "markreel-mcp-upload-"));
  const filePath = path.join(dir, "video.mov");
  const bytes = Buffer.alloc(256 * 1024, 57);
  await writeFile(filePath, bytes);
  try {
    const progress: number[] = [];
    const result = await uploadVideo(f.client, { projectId: "p1", filePath, mode: "original" }, new AbortController().signal, (uploaded) => progress.push(uploaded));
    assert.equal(result.transfer, "api");
    assert.equal(result.sizeBytes, bytes.byteLength);
    assert.equal(f.state.uploads.length, 2);
    for (const uploaded of f.state.uploads) assert.deepEqual(uploaded, bytes);
    assert.ok(f.state.storageCookies.every((cookie) => cookie === undefined));
    assert.equal(progress.at(-1), bytes.byteLength);
    assert.deepEqual(f.state.processBodies, [{ originalObjectKey: "original/m1/key.mov", mode: "original" }]);
    f.state.directStatus = 200;
    const direct = await uploadVideo(f.client, { projectId: "p1", filePath, mode: "original" }, new AbortController().signal);
    assert.equal(direct.transfer, "direct");
    f.state.processStatus = 503;
    await assert.rejects(uploadVideo(f.client, { projectId: "p1", filePath, mode: "original" }, new AbortController().signal),
      (error: unknown) => error instanceof UploadError && error.recovery.mediaId === "m1" && error.recovery.stage === "process" && error.recovery.objectKey === "original/m1/key.mov");
    assert.equal(f.state.creates, 3);
  } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
});

test("validates local upload paths before creating media and rejects unsafe configuration without exposing secrets", async () => {
  const f = await fixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), "markreel-mcp-roots-"));
  const roots = path.join(dir, "allowed");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(roots);
  const video = path.join(dir, "outside.mp4");
  await writeFile(video, "video");
  try {
    const restricted = new MarkReelClient({ ...f.config, uploadRoots: [roots] });
    await assert.rejects(uploadVideo(restricted, { projectId: "p1", filePath: video, mode: "original" }, new AbortController().signal), /outside MARKREEL/);
    await assert.rejects(uploadVideo(f.client, { projectId: "p1", filePath: "relative.mp4", mode: "original" }, new AbortController().signal), /absolute path/);
    await assert.rejects(uploadVideo(f.client, { projectId: "p1", filePath: path.join(dir, "secret.txt"), mode: "original" }, new AbortController().signal), /Unsupported video/);
    assert.equal(f.state.creates, 0);
    assert.throws(() => readConfig({ MARKREEL_MCP_PASSWORD: "secret" }), (error: unknown) => error instanceof Error && !error.message.includes("secret"));
    assert.throws(() => readConfig({ MARKREEL_MCP_BASE_URL: "https://user:secret@example.com", MARKREEL_MCP_USERNAME: "user", MARKREEL_MCP_PASSWORD: "password123" }), /without credentials/);
  } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
});

test("reopens a streaming file after an early storage rejection and preserves recovery on cancellation", async () => {
  const f = await fixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), "markreel-mcp-cancel-"));
  const filePath = path.join(dir, "video.mp4");
  const bytes = Buffer.alloc(8 * 1024 * 1024, 23);
  await writeFile(filePath, bytes);
  try {
    f.state.rejectEarly = true;
    const result = await uploadVideo(f.client, { projectId: "p1", filePath, mode: "original" }, new AbortController().signal);
    assert.equal(result.transfer, "api");
    assert.deepEqual(f.state.uploads.at(-1), bytes);
    const controller = new AbortController();
    await assert.rejects(uploadVideo(f.client, { projectId: "p1", filePath, mode: "original" }, controller.signal, () => controller.abort()),
      (error: unknown) => error instanceof UploadError && error.recovery.mediaId === "m1" && error.recovery.stage === "transfer");
    assert.equal(f.state.processBodies.length, 1);
  } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
});

test("the Skill helper streams to a remote API and can reuse a prepared upload slot", async () => {
  const f = await fixture();
  const dir = await mkdtemp(path.join(os.tmpdir(), "markreel-skill-upload-"));
  const filePath = path.join(dir, "video.mov");
  const bytes = Buffer.alloc(2 * 1024 * 1024, 41);
  await writeFile(filePath, bytes);
  const run = promisify(execFile);
  const script = fileURLToPath(new URL("../../../skills/markreel/scripts/upload.py", import.meta.url));
  const env = { ...process.env, MARKREEL_URL: f.config.baseUrl, MARKREEL_TOKEN: `mr_token_${"a".repeat(43)}` };
  try {
    const uploaded = await run("python", [script, "--project-id", "p1", "--file", filePath], { env });
    const result = JSON.parse(uploaded.stdout);
    assert.equal(result.mediaId, "m1");
    assert.deepEqual(f.state.uploads.at(-1), bytes);
    await run("python", [script, "--media-id", "m1", "--object-key", result.originalObjectKey, "--file", filePath], { env });
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.logins, 0);
    assert.equal(f.state.processBodies.length, 2);
  } finally { await f.close(); await rm(dir, { recursive: true, force: true }); }
});
