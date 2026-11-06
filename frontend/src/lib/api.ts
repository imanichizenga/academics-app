export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public data: Record<string, unknown> = {}) {
    super(message);
  }
  get fields() {
    return (this.data.fields ?? {}) as Record<string, string>;
  }
}

function cookie(name: string) {
  if (typeof document === "undefined") return "";
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=")[1] ?? "";
}
export const hasSessionCookie = () => Boolean(cookie("csrf_token"));

let refreshing: Promise<boolean> | null = null;
export function refreshSession() {
  refreshing ??= fetch("/api/v1/auth/refresh/", { method: "POST", credentials: "include" })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => { refreshing = null; });
  return refreshing;
}

type Options = { method?: string; body?: unknown; headers?: Record<string, string>; retry?: boolean; form?: FormData };

export async function api<T = any>(path: string, opts: Options = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? "POST" : "GET");
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-CSRF-Token"] = cookie("csrf_token");
  let response: Response;
  try {
    response = await fetch(path.startsWith("/api") ? path : `/api/v1${path}`, {
      method, headers, credentials: "include",
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    throw new ApiError(0, "network", "You appear to be offline. Check your connection and try again.");
  }
  if (response.status === 401 && opts.retry !== false && hasSessionCookie() && !path.startsWith("/auth/refresh")) {
    if (await refreshSession()) return api<T>(path, { ...opts, retry: false });
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const e = data?.error ?? {};
    if (e.code === "password_change_required" && typeof location !== "undefined" && location.pathname !== "/change-password") {
      location.href = "/change-password?forced=1";
    }
    throw new ApiError(response.status, e.code ?? "error", e.message ?? "Something went wrong. Please try again.", e);
  }
  return data as T;
}
export const post = <T = any>(path: string, body: unknown = {}, headers?: Record<string, string>) =>
  api<T>(path, { method: "POST", body, headers });
export const patch = <T = any>(path: string, body: unknown) => api<T>(path, { method: "PATCH", body });
export const del = (path: string) => api(path, { method: "DELETE" });
