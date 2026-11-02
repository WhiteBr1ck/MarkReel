import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, request } from "node:http";
import test from "node:test";
import Fastify from "fastify";

test("S3 proxy survives interrupted uploads and early storage errors", { timeout: 15000 }, async (t) => {
  let storageStatus = 200;
  let onStorageData = () => {};
  const storage = createServer((req, res) => {
    if (storageStatus !== 200) {
      res.writeHead(storageStatus, { "content-type": "application/xml" });
      res.end("<Error><Code>XMinioStorageFull</Code><Message>Storage full</Message></Error>");
      return;
    }
    req.on("error", () => {});
    req.on("data", () => onStorageData());
    req.on("end", () => { res.writeHead(200, { ETag: '"test"' }); res.end(); });
  });
  storage.listen(0, "127.0.0.1");
  await once(storage, "listening");
  const storageAddress = storage.address();
  assert.ok(storageAddress && typeof storageAddress !== "string");
  Object.assign(process.env, {
    MARKREEL_STORE: "inmemory",
    S3_ENDPOINT: `http://127.0.0.1:${storageAddress.port}`,
    S3_ACCESS_KEY: "test",
    S3_SECRET_KEY: "test",
    S3_BUCKET_ORIGINAL: "original",
    S3_BUCKET_DERIVED: "derived",
    S3_BUCKET_ATTACHMENTS: "attachments"
  });
  const { putRequestBodyObject } = await import("./uploadProxy");
  const { s3 } = await import("./s3");
  const app = Fastify();
  let onUploadError = (_error: unknown) => {};
  app.addContentTypeParser("*", (_req, payload, done) => done(null, payload));
  app.get("/health", async () => ({ ok: true }));
  app.put("/upload", async (req) => {
    try {
      await putRequestBodyObject({ req, bucket: "original", objectKey: "test", contentType: "video/mp4" });
      return { ok: true };
    } catch (error) {
      onUploadError(error);
      throw error;
    }
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  const uploadUrl = `http://127.0.0.1:${address.port}/upload`;
  try {
    await t.test("complete upload succeeds without optional AWS checksum framing", async () => {
      const response = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body: "video" });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    });
    await t.test("client disconnect is caught and subsequent requests still work", async () => {
      let resolveData!: () => void;
      const dataReceived = new Promise<void>((resolve) => { resolveData = resolve; });
      onStorageData = resolveData;
      let resolveError!: (error: unknown) => void;
      const uploadError = new Promise<unknown>((resolve) => { resolveError = resolve; });
      onUploadError = resolveError;
      const upload = request(uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": "1048576" } });
      upload.on("error", () => {});
      upload.write(Buffer.alloc(4096));
      await dataReceived;
      upload.destroy();
      const error = await uploadError;
      assert.ok(error instanceof Error);
      assert.equal(error.message, "upload_aborted");
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal((await app.inject("/health")).statusCode, 200);
      onStorageData = () => {};
    });
    await t.test("storage rejects an upload while its source is still open", async () => {
      storageStatus = 507;
      const upload = request(uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4", "content-length": "1048576" } });
      upload.on("error", () => {});
      const response = once(upload, "response");
      upload.write(Buffer.alloc(4096));
      const [res] = await response;
      assert.equal(res.statusCode, 500);
      res.resume();
      upload.destroy();
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.equal((await app.inject("/health")).statusCode, 200);
    });
  } finally {
    await app.close();
    s3.destroy();
    storage.closeAllConnections();
    await new Promise<void>((resolve) => storage.close(() => resolve()));
  }
});
