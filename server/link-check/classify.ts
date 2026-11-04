/**
 * Classify one external URL from a single GET. Built to answer "is this definitely dead?",
 * not "is this OK?": bot walls (403, 429, 999, challenge pages), timeouts and 5xx are
 * `unknown`, never `gone`.
 */

export type FetchLike = typeof fetch;

export type LinkCheckStatus = "ok" | "gone" | "unreachable" | "unknown";
export type LinkCheckReason = "not_found" | "redirected_to_home" | "unreachable";

export type LinkCheckResult = {
  status: LinkCheckStatus;
  reason?: LinkCheckReason;
  http_status?: number;
  /** Where redirects ended, when different from the requested URL. */
  final_url?: string;
  error?: string;
};

export const LINK_CHECK_TIMEOUT_MS = 20_000;
const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,es;q=0.8",
};

/** DNS name does not exist, or the certificate does not match / is invalid. Temporary DNS (EAI_AGAIN) is excluded. */
const UNREACHABLE_CODES = new Set([
  "ENOTFOUND",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_NOT_YET_VALID",
]);

const LOCALE_ROOT_RE = /^\/(?:[a-z]{2}(?:[-_][a-z]{2})?\/?)?$/i;

/** `/`, `/en`, `/es/`, `/en-us` … */
export function isRootPath(pathname: string): boolean {
  return pathname === "" || LOCALE_ROOT_RE.test(pathname);
}

function errorCode(err: unknown): string | null {
  const e = err as { code?: unknown; cause?: { code?: unknown; message?: unknown }; message?: unknown };
  const code = e?.cause?.code ?? e?.code;
  if (typeof code === "string" && code) return code;
  const text = `${String(e?.message ?? "")} ${String(e?.cause?.message ?? "")}`;
  for (const c of UNREACHABLE_CODES) if (text.includes(c)) return c;
  if (/certificate|altname|subject name/i.test(text)) return "ERR_TLS_CERT_ALTNAME_INVALID";
  return null;
}

function pathnameOf(raw: string): string | null {
  try {
    return new URL(raw).pathname;
  } catch {
    return null;
  }
}

export async function classifyUrl(
  url: string,
  opts: { fetchImpl?: FetchLike; timeoutMs?: number } = {},
): Promise<LinkCheckResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(opts.timeoutMs ?? LINK_CHECK_TIMEOUT_MS),
    });
  } catch (err) {
    const code = errorCode(err);
    if (code && UNREACHABLE_CODES.has(code)) return { status: "unreachable", reason: "unreachable", error: code };
    return { status: "unknown", error: code ?? (err as Error)?.name ?? "fetch_failed" };
  }
  try {
    await res.body?.cancel();
  } catch {
    /* body already consumed or closed */
  }

  const http_status = res.status;
  const final_url = res.url && res.url !== url ? res.url : undefined;
  if (http_status === 404 || http_status === 410) {
    return { status: "gone", reason: "not_found", http_status, ...(final_url ? { final_url } : {}) };
  }
  if (http_status >= 200 && http_status < 400) {
    const requested = pathnameOf(url);
    const landed = final_url ? pathnameOf(final_url) : null;
    if (res.redirected && requested && landed !== null && !isRootPath(requested) && isRootPath(landed)) {
      return { status: "gone", reason: "redirected_to_home", http_status, final_url };
    }
    return { status: "ok", http_status, ...(final_url ? { final_url } : {}) };
  }
  return { status: "unknown", http_status };
}
