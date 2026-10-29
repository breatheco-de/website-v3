/** Inline feedback for the SEO modal "Add redirect" input (the server re-checks on save). */

export type RedirectPreviewResult = {
  match?: boolean;
  from?: string;
  to?: string | Record<string, string>;
  resolvedTo?: string;
  source?: string;
  matchType?: "exact" | "regex" | "canonical";
  pageExists?: boolean;
  live_content?: boolean;
};

const HOME_PATHS = new Set(["/", "/en", "/es", "/us", "/es/home"]);

/** Staff input as a lowercase site path without trailing slash; "" when empty. */
export function normalizeRedirectInput(raw: string): string {
  let p = (raw ?? "").trim();
  if (!p) return "";
  if (/^https?:\/\//i.test(p)) {
    try {
      p = new URL(p).pathname;
    } catch {
      return p.toLowerCase();
    }
  }
  p = p.toLowerCase();
  if (!p.startsWith("/")) p = `/${p}`;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

/** Plain-English reason the path cannot be added, or null when it looks free. */
export function previewRedirectBlock(
  input: string,
  pagePath: string,
  result: RedirectPreviewResult | null,
): string | null {
  if (!input) return null;
  if (input === normalizeRedirectInput(pagePath)) {
    return `${input} is this page's own address. Redirecting it here would loop.`;
  }
  if (HOME_PATHS.has(input)) return `${input} is a homepage address and cannot redirect to a page.`;
  if (!result) return null;
  if (result.live_content || result.pageExists) {
    return `${input} is already a live page. A redirect would hide it.`;
  }
  if (!result.match) return null;
  if (result.matchType === "regex") {
    return `${input} is already handled by the pattern rule ${result.from ?? ""}.`.replace(/ \.$/, ".");
  }
  const dest = result.resolvedTo ? normalizeRedirectInput(result.resolvedTo) : "";
  if (dest && dest === normalizeRedirectInput(pagePath)) return `${input} already redirects to this page.`;
  return `${input} already redirects to ${result.resolvedTo || "another address"}.`;
}
