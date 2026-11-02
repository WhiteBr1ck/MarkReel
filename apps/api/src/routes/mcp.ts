import { Readable } from "node:stream";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { createMcpHandler, createMcpServer } from "@markreel/mcp/server";
import packageJson from "../../../../package.json";
import { MarkReelClient } from "@markreel/mcp/client";
import { bearerApiToken } from "../auth/apiTokens";
import { requireUser } from "../auth/requireUser";
import { env } from "../env";

function publicBaseUrl(req: FastifyRequest) {
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  const protocol = req.headers["x-forwarded-proto"] ?? req.protocol;
  try {
    const url = new URL(`${String(protocol).split(",")[0]!.trim()}://${String(host).split(",")[0]!.trim()}`);
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password) return url.origin;
  } catch { /* Fall back to the configured address. */ }
  return env.WEB_BASE_URL.replace(/\/$/, "");
}

export async function mcpRoutes(app: FastifyInstance) {
  // Internal requests still run the existing route's authentication, access checks and audit logging.
  const internalFetch: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== "http://markreel.internal" || !url.pathname.startsWith("/api/") || url.pathname === "/api/mcp") {
      throw new Error("Invalid internal MCP request");
    }
    init?.signal?.throwIfAborted();
    if (init?.body !== undefined && typeof init.body !== "string") throw new Error("Binary uploads require the public upload endpoint");
    const method = init?.method ?? "GET";
    if (!["GET", "POST", "PATCH", "PUT", "DELETE", "HEAD"].includes(method)) throw new Error("Invalid internal MCP method");
    const response = await app.inject({ method: method as "GET" | "POST" | "PATCH" | "PUT" | "DELETE" | "HEAD", url: `${url.pathname}${url.search}`,
      headers: Object.fromEntries(new Headers(init?.headers)), payload: init?.body ?? undefined });
    init?.signal?.throwIfAborted();
    const headers = new Headers();
    for (const [key, value] of Object.entries(response.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }
    return new Response([204, 304].includes(response.statusCode) ? null : response.rawPayload, { status: response.statusCode, headers });
  };

  app.route({
    method: ["GET", "POST", "DELETE"], url: "/mcp", bodyLimit: 4 * 1024 * 1024,
    preHandler: async (req, reply) => {
      if (!bearerApiToken(req)) return reply.header("www-authenticate", 'Bearer realm="MarkReel"').code(401).send({ error: "api_token_required" });
      return requireUser(req, reply);
    },
    handler: async (req, reply) => {
      const baseUrl = publicBaseUrl(req);
      if (req.headers.origin && ![baseUrl, new URL(env.WEB_BASE_URL).origin].includes(req.headers.origin)) {
        return reply.code(403).send({ error: "invalid_origin" });
      }
      const controller = new AbortController();
      const onAborted = () => controller.abort();
      req.raw.once("aborted", onAborted);
      const api = new MarkReelClient({ baseUrl: "http://markreel.internal", username: "", password: "", apiToken: bearerApiToken(req)!,
        readOnly: req.apiTokenReadOnly ?? false, uploadRoots: [], transferTimeoutMs: 3_600_000 }, internalFetch);
      const handler = createMcpHandler(() => createMcpServer(api, packageJson.version, { localUploads: false, publicBaseUrl: baseUrl }), { maxSubscriptions: 0 });
      const cleanup = () => {
        req.raw.removeListener("aborted", onAborted);
        if (!reply.raw.writableEnded) controller.abort();
        void handler.close().catch(() => undefined);
      };
      reply.raw.once("close", cleanup);
      try {
        const headers = new Headers();
        for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
        const request = new Request(`${baseUrl}/api/mcp`, { method: req.method, headers,
          body: req.method === "POST" ? JSON.stringify(req.body) : undefined, signal: controller.signal });
        const response = await handler.fetch(request, { parsedBody: req.body });
        reply.code(response.status).header("cache-control", "no-store").header("x-accel-buffering", "no");
        response.headers.forEach((value, name) => reply.header(name, value));
        return reply.send(response.body ? Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]) : undefined);
      } catch (error) {
        cleanup();
        throw error;
      }
    }
  });
}
