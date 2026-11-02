import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { InMemoryTransport } from "@modelcontextprotocol/server";
import { MarkReelClient } from "./client.js";
import { readConfig } from "./config.js";
import { createMcpServer } from "./server.js";

function data(result: { content: Array<{ type: string; text?: string }> }) {
  const item = result.content.find((content) => content.type === "text");
  assert.ok(item?.text);
  return JSON.parse(item.text);
}

async function connect(api: MarkReelClient) {
  const server = createMcpServer(api, "test");
  const client = new Client({ name: "markreel-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, close: async () => { await client.close(); await server.close(); } };
}

test("MCP tools use real API authentication, SQLite persistence and project/media/annotation permissions", { timeout: 60000 }, async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "markreel-mcp-api-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const emptyEnv = path.join(dir, "empty.env");
  await writeFile(emptyEnv, "");
  await writeFile(path.join(dir, "test.db"), "");
  const storage = createServer((_req, res) => res.end());
  t.after(async () => {
    storage.closeAllConnections();
    await new Promise<void>((resolve) => storage.close(() => resolve()));
  });
  storage.listen(0, "127.0.0.1");
  await once(storage, "listening");
  const storageAddress = storage.address();
  assert.ok(storageAddress && typeof storageAddress !== "string");
  Object.assign(process.env, {
    MARKREEL_ENV_FILE: emptyEnv, MARKREEL_SKIP_BOOTSTRAP: "true", MARKREEL_STORE: "sqlite",
    MARKREEL_ALLOW_PUBLIC_REGISTRATION: "true", WEB_BASE_URL: "http://localhost:5090", API_BASE_URL: "http://localhost:4000",
    DATABASE_URL: `file:${path.join(dir, "test.db").replace(/\\/g, "/")}`,
    JWT_ACCESS_SECRET: "mcp_test_access_secret_123456", JWT_REFRESH_SECRET: "mcp_test_refresh_secret_123456",
    JWT_AUTH_INSTANCE_ID: "mcp-test-instance", S3_ENDPOINT: `http://127.0.0.1:${storageAddress.port}`,
    S3_REGION: "us-east-1", S3_ACCESS_KEY: "test", S3_SECRET_KEY: "test",
    S3_BUCKET_ORIGINAL: "original", S3_BUCKET_DERIVED: "derived", S3_BUCKET_ATTACHMENTS: "attachments",
    MARKREEL_ADMIN_USERNAME: "admin", MARKREEL_ADMIN_PASSWORD: "adminadmin"
  });
  delete process.env.REDIS_URL;
  const require = createRequire(import.meta.url);
  try {
    execFileSync(process.execPath, [require.resolve("prisma/build/index.js"), "db", "push", "--skip-generate", "--schema", fileURLToPath(new URL("../../api/prisma/schema.prisma", import.meta.url))], { env: process.env, stdio: "pipe" });
  } catch (error) {
    const output = error as { stderr?: Buffer };
    throw new Error(`Test database setup failed: ${output.stderr?.toString() ?? "unknown error"}`);
  }
  const { buildApp } = await import("../../api/src/main.ts");
  const { assertDeletedCredentialsStayInvalid } = await import("../../api/src/auth/credentialLifecycleFixture.ts");
  const { prisma } = await import("../../api/src/db.ts");
  const { s3 } = await import("../../api/src/s3.ts");
  const app = await buildApp();
  const connections: Array<Awaited<ReturnType<typeof connect>>> = [];
  let stdio: Client | undefined;
  const remoteClients: Client[] = [];
  try {
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    await assertDeletedCredentialsStayInvalid(app, "revive_sql");
    for (const username of ["mcp_owner", "mcp_outsider"]) {
      const registration = await app.inject({ method: "POST", url: "/api/auth/register", payload: { username, password: "password123" } });
      assert.equal(registration.statusCode, 200);
    }
    const config = readConfig({ MARKREEL_MCP_BASE_URL: `http://127.0.0.1:${address.port}`, MARKREEL_MCP_USERNAME: "mcp_owner", MARKREEL_MCP_PASSWORD: "password123" });
    const api = new MarkReelClient(config);
    const owner = await connect(api);
    connections.push(owner);
    const tools = (await owner.client.listTools()).tools;
    assert.ok(tools.some((tool) => tool.name === "upload_video"));
    assert.ok(tools.some((tool) => tool.name === "import_server_video"));
    assert.ok(tools.find((tool) => tool.name === "delete_project")?.annotations?.destructiveHint);
    const created = await owner.client.callTool({ name: "create_project", arguments: { name: "MCP Project" } });
    const projectId = data(created).project.id;
    assert.ok(data(await owner.client.callTool({ name: "list_projects", arguments: {} })).projects.some((project: { id: string }) => project.id === projectId));
    await owner.client.callTool({ name: "rename_project", arguments: { projectId, name: "Renamed by AI" } });
    assert.equal(data(await owner.client.callTool({ name: "get_project", arguments: { projectId } })).project.name, "Renamed by AI");
    const folderId = data(await owner.client.callTool({ name: "create_folder", arguments: { projectId, name: "Folder" } })).folder.id;
    const media = await api.request<{ media: { id: string } }>(`/projects/${projectId}/media`, { method: "POST", body: { title: "Review video", folderId } });
    const mediaId = media.media.id;
    const wrongObject = await owner.client.callTool({ name: "process_uploaded_video", arguments: { mediaId, originalObjectKey: "original/another-video/object.mp4" } });
    assert.equal(wrongObject.isError, true);
    assert.match(data(wrongObject).error, /does not belong/);
    const annotationId = data(await owner.client.callTool({ name: "create_annotation", arguments: { mediaId, timestampMs: 1000, body: "Check this frame", color: "#ff0000" } })).id;
    const reply = await owner.client.callTool({ name: "create_annotation", arguments: { mediaId, timestampMs: 1000, body: "Reply", parentId: annotationId } });
    assert.ok(data(reply).id);
    await owner.client.callTool({ name: "set_annotation_completed", arguments: { annotationId, completed: true } });
    const annotations = data(await owner.client.callTool({ name: "list_annotations", arguments: { mediaId } })).annotations;
    assert.equal(annotations.length, 1);
    assert.equal(annotations[0].replies.length, 1);
    assert.ok(annotations[0].completedAt);
    await owner.client.callTool({ name: "update_annotation", arguments: { annotationId, body: "Updated by AI" } });
    assert.equal((await prisma.annotation.findUnique({ where: { id: annotationId } }))?.body, "Updated by AI");

    const outsider = await connect(new MarkReelClient({ ...config, username: "mcp_outsider" }));
    connections.push(outsider);
    assert.equal(data(await outsider.client.callTool({ name: "list_projects", arguments: {} })).projects.length, 0);
    const denied = await outsider.client.callTool({ name: "create_annotation", arguments: { mediaId, timestampMs: 0, body: "Unauthorized" } });
    assert.equal(denied.isError, true);
    assert.match(data(denied).error, /not_found/);
    assert.equal(await prisma.annotation.count({ where: { mediaId } }), 2);

    const readonly = await connect(new MarkReelClient({ ...config, readOnly: true }));
    connections.push(readonly);
    const readonlyTools = (await readonly.client.listTools()).tools;
    assert.ok(readonlyTools.every((tool) => tool.annotations?.readOnlyHint));
    assert.ok(!readonlyTools.some((tool) => tool.name === "create_annotation" || tool.name === "upload_video"));

    stdio = new Client({ name: "markreel-stdio-test", version: "1.0.0" });
    await stdio.connect(new StdioClientTransport({
      command: process.execPath, args: [fileURLToPath(new URL("../dist/main.js", import.meta.url))], cwd: os.tmpdir(),
      env: { MARKREEL_MCP_BASE_URL: config.baseUrl, MARKREEL_MCP_USERNAME: config.username, MARKREEL_MCP_PASSWORD: config.password }
    }));
    assert.equal(stdio.getServerVersion()?.name, "markreel");
    assert.ok(data(await stdio.callTool({ name: "list_projects", arguments: {} })).projects.some((project: { id: string }) => project.id === projectId));
    await owner.client.callTool({ name: "delete_annotation", arguments: { annotationId } });
    assert.equal(data(await owner.client.callTool({ name: "list_annotations", arguments: { mediaId } })).annotations.length, 0);

    const fullToken = await api.request<{ token: string; apiToken: { id: string } }>("/users/me/api-tokens", { method: "POST", body: { name: "Remote AI" } });
    const skillArchive = await fetch(`${config.baseUrl}/api/integrations/markreel-skill.zip`, { headers: { Authorization: `Bearer ${fullToken.token}` } });
    assert.equal(skillArchive.status, 200);
    const archiveBytes = Buffer.from(await skillArchive.arrayBuffer());
    assert.equal(archiveBytes.subarray(0, 2).toString(), "PK");
    assert.ok(archiveBytes.includes(Buffer.from("markreel/SKILL.md")));
    assert.ok(archiveBytes.includes(Buffer.from("markreel/scripts/upload.py")));
    const remote = new Client({ name: "remote-mcp-test", version: "1.0.0" });
    remoteClients.push(remote);
    await remote.connect(new StreamableHTTPClientTransport(new URL(`${config.baseUrl}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${fullToken.token}` } } }));
    const remoteTools = (await remote.listTools()).tools;
    assert.ok(remoteTools.some((tool) => tool.name === "prepare_video_upload"));
    assert.ok(!remoteTools.some((tool) => tool.name === "upload_video"));
    assert.ok(data(await remote.callTool({ name: "list_projects", arguments: {} })).projects.some((project: { id: string }) => project.id === projectId));
    const remoteAnnotation = data(await remote.callTool({ name: "create_annotation", arguments: { mediaId, timestampMs: 2000, body: "Created through remote MCP" } }));
    assert.equal((await prisma.annotation.findUnique({ where: { id: remoteAnnotation.id } }))?.body, "Created through remote MCP");
    const tokenListing = await api.request("/users/me/api-tokens");
    assert.ok(!JSON.stringify(tokenListing).includes(fullToken.token));
    assert.ok(!JSON.stringify(tokenListing).includes("tokenHash"));
    assert.equal((await app.inject({ method: "POST", url: "/api/mcp", payload: {} })).statusCode, 401);
    assert.equal((await app.inject({ method: "POST", url: "/api/mcp", headers: { authorization: `Bearer ${fullToken.token}`, origin: "https://unrelated.example" }, payload: {} })).statusCode, 403);
    const readonlyToken = await api.request<{ token: string; apiToken: { id: string } }>("/users/me/api-tokens", { method: "POST", body: { name: "Read only AI", readOnly: true } });
    const remoteReadonly = new Client({ name: "remote-readonly-test", version: "1.0.0" });
    remoteClients.push(remoteReadonly);
    await remoteReadonly.connect(new StreamableHTTPClientTransport(new URL(`${config.baseUrl}/api/mcp`), { requestInit: { headers: { Authorization: `Bearer ${readonlyToken.token}` } } }));
    assert.ok((await remoteReadonly.listTools()).tools.every((tool) => tool.annotations?.readOnlyHint));
    assert.equal((await app.inject({ method: "POST", url: "/api/projects", headers: { authorization: `Bearer ${readonlyToken.token}` }, payload: { name: "Blocked" } })).statusCode, 403);
    await api.request(`/users/me/api-tokens/${fullToken.apiToken.id}`, { method: "DELETE" });
    assert.equal((await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: `Bearer ${fullToken.token}` } })).statusCode, 401);
    await prisma.apiAccessToken.update({ where: { id: readonlyToken.apiToken.id }, data: { expiresAt: new Date(0) } });
    assert.equal((await app.inject({ method: "GET", url: "/api/projects", headers: { authorization: `Bearer ${readonlyToken.token}` } })).statusCode, 401);
  } finally {
    for (const remote of remoteClients) await remote.close().catch(() => undefined);
    await stdio?.close();
    for (const connection of connections) await connection.close();
    await app.close();
    await prisma.$disconnect();
    s3.destroy();
  }
});
