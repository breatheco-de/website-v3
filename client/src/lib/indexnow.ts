import { apiFetch } from "@/lib/queryClient";

export type IndexNowStatus = {
  enabled: boolean;
  key: string;
  keyFileUrl: string | null;
  host: string | null;
  live: boolean;
  bookmark: number;
  waiting: number;
  totalUrls: number;
  lastRunAt: number | null;
  lastStatus: string | null;
  lastError: string | null;
  lastSubmittedCount: number;
  verifiedAt: number | null;
  rejectedSince: number | null;
  nextAttemptAt: number | null;
  stoppedAt: number | null;
  paused: boolean;
  held: { reason: "large_drop"; removedCount: number; at: number | null } | null;
  stuck: boolean;
};

export type PublicUrlChangeKind = "published" | "updated" | "moved" | "removed";

export type StaffPublicUrlChange = {
  id: number;
  url: string;
  kind: PublicUrlChangeKind;
  previousUrl: string | null;
  contentType: string | null;
  slug: string | null;
  locale: string | null;
  detectedAt: number;
  sent: boolean;
};

export type PublicUrlChangesResponse = {
  changes: StaffPublicUrlChange[];
  summary: { changesThisWeek: number; sentThisWeek: number; waiting: number; bookmark: number };
};

export type IndexNowTestResponse = {
  ok: boolean;
  mode: "notice" | "key_file";
  status?: number | null;
  outcome?: string;
  detail: string;
  url?: string;
};

export const INDEXNOW_STATUS_KEY = ["/api/indexnow/status"] as const;
export const PUBLIC_URL_CHANGES_KEY = "/api/public-url-changes";

export async function fetchIndexNowStatus(): Promise<IndexNowStatus> {
  const res = await apiFetch("/api/indexnow/status");
  if (!res.ok) throw new Error("Failed to load IndexNow status");
  return res.json();
}

export async function fetchPublicUrlChanges(opts?: { limit?: number; path?: string }): Promise<PublicUrlChangesResponse> {
  const params = new URLSearchParams();
  params.set("limit", String(opts?.limit ?? 20));
  if (opts?.path) params.set("path", opts.path);
  const res = await apiFetch(`${PUBLIC_URL_CHANGES_KEY}?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load page changes");
  return res.json();
}

/** POST that returns the JSON body even on 4xx (Test connection, confirm). */
export async function postJson<T>(url: string, body?: unknown): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  let parsed: T;
  try {
    parsed = (await res.json()) as T;
  } catch {
    parsed = {} as T;
  }
  return { ok: res.ok, status: res.status, body: parsed };
}

export function indexNowResultLabel(lastStatus: string | null): string {
  switch (lastStatus) {
    case "accepted":
      return "Accepted";
    case "accepted_pending_key":
      return "Accepted, key check pending";
    case "rejected_key":
      return "Key not verified, retrying";
    case "rejected_urls":
      return "Some URLs rejected, retrying";
    case "rate_limited":
      return "Rate limited, will retry";
    case "error":
      return "Search engine unreachable, will retry";
    default:
      return "Nothing sent yet";
  }
}

export function changeKindLabel(kind: PublicUrlChangeKind): string {
  switch (kind) {
    case "published":
      return "Published";
    case "updated":
      return "Edited";
    case "moved":
      return "Moved";
    case "removed":
      return "Removed";
  }
}

export function relativeTime(ms: number | null | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const diff = Math.max(0, now - ms);
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function urlPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || "/";
  } catch {
    return url;
  }
}
