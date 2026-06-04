export type ApiError = Error & {
  status?: number;
  data?: unknown;
};

const REFRESH_PATH = "/auth/refresh";
const NO_REFRESH_RETRY = new Set([REFRESH_PATH, "/auth/login", "/auth/register", "/auth/logout"]);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const res = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "include"
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error("api_error"), { status: res.status, data }) as ApiError;
  return data as T;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    return await request<T>(path, init);
  } catch (error) {
    const apiError = error as ApiError;
    if (apiError.status !== 401 || NO_REFRESH_RETRY.has(path)) {
      throw error;
    }

    await request<{ ok: true }>(REFRESH_PATH, { method: "POST", body: "{}" });
    return request<T>(path, init);
  }
}
