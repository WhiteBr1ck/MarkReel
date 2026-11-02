import type { McpConfig } from "./config.js";

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  timeoutMs?: number;
};

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(`${code} (HTTP ${status})`);
  }
}

export class MarkReelClient {
  private accessCookie = "";
  private refreshCookie = "";
  private authenticating: Promise<void> | null = null;

  constructor(readonly config: McpConfig, private readonly fetcher: typeof fetch = fetch) {}

  private authHeaders(cookie = this.accessCookie): Record<string, string> {
    return this.config.apiToken ? { authorization: `Bearer ${this.config.apiToken}` } : { cookie: `mr_access=${cookie}` };
  }

  apiUrl(route: string) {
    if (!route.startsWith("/") || route.startsWith("//")) throw new Error("Invalid API route");
    return `${this.config.baseUrl}/api${route}`;
  }

  private readCookies(response: Response) {
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(";", 1)[0]!;
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (name === "mr_access") this.accessCookie = value;
      if (name === "mr_refresh") this.refreshCookie = value;
    }
  }

  private async error(response: Response): Promise<ApiError> {
    const data: unknown = await response.json().catch(() => null);
    const code = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      && /^[a-zA-Z0-9_:-]{1,100}$/.test(data.error) ? data.error : "api_request_failed";
    return new ApiError(response.status, code);
  }

  private async authenticate(rejectedCookie?: string) {
    if (this.config.apiToken) return;
    if (this.authenticating) return this.authenticating;
    if (this.accessCookie && (rejectedCookie === undefined || rejectedCookie !== this.accessCookie)) return;
    this.authenticating = (async () => {
      if (this.refreshCookie) {
        const response = await this.fetcher(this.apiUrl("/auth/refresh"), {
          method: "POST",
          headers: { cookie: `mr_refresh=${this.refreshCookie}` },
          signal: AbortSignal.timeout(30_000),
          redirect: "error"
        });
        if (response.ok) {
          this.readCookies(response);
          await response.body?.cancel();
          if (this.accessCookie) return;
        } else {
          await response.body?.cancel();
          if (response.status !== 401) throw new ApiError(response.status, "session_refresh_failed");
        }
        this.accessCookie = "";
        this.refreshCookie = "";
      }
      const response = await this.fetcher(this.apiUrl("/auth/login"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: this.config.username, password: this.config.password }),
        signal: AbortSignal.timeout(30_000),
        redirect: "error"
      });
      if (!response.ok) throw await this.error(response);
      this.readCookies(response);
      await response.body?.cancel();
      if (!this.accessCookie) throw new Error("Login response did not contain a session cookie");
    })();
    try {
      await this.authenticating;
    } finally {
      this.authenticating = null;
    }
  }

  private async response(route: string, options: RequestOptions = {}) {
    if (this.config.readOnly && options.method && options.method !== "GET") throw new Error("MCP is configured as read-only");
    options.signal?.throwIfAborted();
    await this.authenticate();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      options.signal?.throwIfAborted();
      const sentCookie = this.accessCookie;
      const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
      const response = await this.fetcher(this.apiUrl(route), {
        method: options.method ?? "GET",
        headers: {
          ...this.authHeaders(sentCookie),
          ...(options.body !== undefined ? { "content-type": "application/json" } : {})
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
        redirect: "error"
      });
      if (response.status === 401 && attempt === 0 && !this.config.apiToken) {
        await response.body?.cancel();
        await this.authenticate(sentCookie);
        continue;
      }
      if (!response.ok) throw await this.error(response);
      return response;
    }
    throw new ApiError(401, "unauthorized");
  }

  async request<T = unknown>(route: string, options: RequestOptions = {}): Promise<T> {
    const response = await this.response(route, options);
    return response.status === 204 ? {} as T : await response.json() as T;
  }

  async image(route: string, signal?: AbortSignal) {
    const response = await this.response(route, { signal });
    const mimeType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
    if (!mimeType || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
      await response.body?.cancel();
      throw new Error("Unsupported thumbnail format");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Empty thumbnail response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 5 * 1024 * 1024) throw new Error("Thumbnail exceeds 5 MB");
        chunks.push(chunk.value);
      }
      return { mimeType, data: Buffer.concat(chunks).toString("base64") };
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async uploadFile(route: string, createBody: () => ReadableStream<Uint8Array>, size: number, contentType: string, signal: AbortSignal, directUrl?: string) {
    if (this.config.readOnly) throw new Error("MCP is configured as read-only");
    const put = async (url: string, cookie?: string) => {
      const response = await this.fetcher(url, {
        method: "PUT",
        headers: { "content-type": contentType, "content-length": String(size), ...(cookie !== undefined ? this.authHeaders(cookie) : {}) },
        body: createBody(),
        duplex: "half",
        signal,
        redirect: "error"
      } as RequestInit & { duplex: "half" });
      await response.body?.cancel();
      return response;
    };
    if (directUrl) {
      const url = new URL(directUrl, this.apiUrl("/"));
      if (["http:", "https:"].includes(url.protocol) && url.searchParams.has("X-Amz-Signature")) {
        try {
          const probe = await this.fetcher(url.origin, { method: "HEAD", signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]), redirect: "error" });
          await probe.body?.cancel();
          if ((await put(url.href)).ok) return "direct" as const;
        } catch {
          signal.throwIfAborted();
        }
      }
    }
    await this.authenticate();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sentCookie = this.accessCookie;
      const response = await put(this.apiUrl(route), sentCookie);
      if (response.status === 401 && attempt === 0 && !this.config.apiToken) {
        await this.authenticate(sentCookie);
        continue;
      }
      if (!response.ok) throw new ApiError(response.status, "video_upload_failed");
      return "api" as const;
    }
    throw new ApiError(401, "unauthorized");
  }
}
