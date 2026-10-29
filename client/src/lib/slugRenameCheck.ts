import type { SlugRenameCheckStatus } from "@/components/DebugBubble/types";
import { isSlug } from "@shared/slug";

export interface SlugRenameCheckParams {
  contentType: string | null | undefined;
  folderSlug: string | null | undefined;
  locale: string;
  newSlug: string;
  currentSlug: string;
}

export interface SlugRenameCheckResult {
  status: SlugRenameCheckStatus;
  reason: string | null;
}

export const SLUG_CHECK_DEBOUNCE_MS = 300;

const IDLE: SlugRenameCheckResult = { status: "idle", reason: null };

/** Instant client-side verdict, or null when the server must decide. */
export function localSlugCheck(params: SlugRenameCheckParams): SlugRenameCheckResult | null {
  const { contentType, folderSlug, newSlug, currentSlug } = params;
  if (!newSlug || !contentType || !folderSlug || newSlug === currentSlug) return IDLE;
  if (!isSlug(newSlug)) {
    return { status: "taken", reason: "Use only lowercase letters, numbers, and hyphens" };
  }
  return null;
}

interface CheckResponseBody {
  available?: boolean;
  code?: string;
  reason?: string;
  error?: string;
  conflictUrl?: string;
}

/** Map the check endpoint's HTTP status + body to what the slug editor shows. */
export function mapSlugCheckResponse(httpStatus: number, body: CheckResponseBody): SlugRenameCheckResult {
  if (httpStatus >= 200 && httpStatus < 300 && body.available) {
    return { status: "available", reason: null };
  }
  if (httpStatus === 403) {
    return { status: "forbidden", reason: "You don't have permission to change this page's URL" };
  }
  if (httpStatus === 503 && body.code === "index_warming") {
    return { status: "error", reason: "Still loading site content, try again in a moment." };
  }
  if (httpStatus === 409 || httpStatus === 400) {
    if (body.code === "slug_already_owned_by_other_entry" && body.conflictUrl) {
      return { status: "taken", reason: `Already used by ${body.conflictUrl}` };
    }
    const raw = body.reason || body.error || "This slug can't be used";
    return { status: "taken", reason: raw.replace(/^[a-z_]+:\s*/, "") };
  }
  return { status: "error", reason: "Couldn't check this slug." };
}

export interface SlugRenameCheckerOptions {
  onResult: (result: SlugRenameCheckResult) => void;
  getHeaders?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
  delayMs?: number;
}

/**
 * Debounced, abortable availability checker. Only the latest `update()` can report a result.
 * Framework-free so it can be unit tested with fake timers.
 */
export function createSlugRenameChecker(opts: SlugRenameCheckerOptions) {
  const delayMs = opts.delayMs ?? SLUG_CHECK_DEBOUNCE_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  let last: SlugRenameCheckParams | null = null;

  const cancelPending = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    controller?.abort();
    controller = null;
  };

  const run = async (params: SlugRenameCheckParams) => {
    const ctrl = new AbortController();
    controller = ctrl;
    const doFetch = opts.fetchImpl ?? fetch;
    try {
      const res = await doFetch("/api/content/rename-slug/check", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(opts.getHeaders?.() ?? {}) },
        body: JSON.stringify({
          contentType: params.contentType,
          folderSlug: params.folderSlug,
          locale: params.locale,
          newSlug: params.newSlug,
        }),
        signal: ctrl.signal,
      });
      const body = (await res.json().catch(() => ({}))) as CheckResponseBody;
      if (ctrl.signal.aborted) return;
      opts.onResult(mapSlugCheckResponse(res.status, body));
    } catch {
      if (ctrl.signal.aborted) return;
      opts.onResult({ status: "error", reason: "Couldn't check this slug." });
    } finally {
      if (controller === ctrl) controller = null;
    }
  };

  const update = (params: SlugRenameCheckParams) => {
    last = params;
    cancelPending();
    const local = localSlugCheck(params);
    if (local) {
      opts.onResult(local);
      return;
    }
    opts.onResult({ status: "checking", reason: null });
    timer = setTimeout(() => {
      timer = null;
      void run(params);
    }, delayMs);
  };

  const retry = () => {
    if (last) update(last);
  };

  return { update, retry, dispose: cancelPending };
}
