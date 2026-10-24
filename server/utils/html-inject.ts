/**
 * Literal-safe HTML string injection.
 *
 * `String.prototype.replace` with a *string* replacement expands `$1`, `$&`,
 * `` $` ``, `$'` and `$$`. CMS copy (prices like "$135K", regex samples in
 * how-to articles) must never be passed that way — always use a replacer
 * function, whose return value is inserted verbatim.
 */

/** Replace the first match of `search` with `value`, inserted literally. */
export function replaceLiteral(html: string, search: string | RegExp, value: string): string {
  return html.replace(search, () => value);
}

/** Insert `fragment` immediately before the first occurrence of `marker`. */
export function insertBefore(html: string, marker: string, fragment: string): string {
  return html.replace(marker, () => fragment + marker);
}

const PAGE_VERSION_SCRIPT_RE = /<script id="__AB_PAGE_VERSION__">[\s\S]*?<\/script>\n?/g;
const GTM_MARKER = "<!-- Google Tag Manager";

/** `_page_version` seeded on the page query, if any. */
export function pageVersionFromPayload(
  payload: unknown,
): { experiment_id: string; variant: string } | null {
  const queries = (payload as { queries?: Array<{ data?: unknown }> } | null)?.queries;
  if (!Array.isArray(queries)) return null;
  for (const q of queries) {
    const pv = (q?.data as { _page_version?: { experiment_id?: unknown; variant?: unknown } } | undefined)
      ?._page_version;
    if (pv && typeof pv.experiment_id === "string" && typeof pv.variant === "string") {
      return { experiment_id: pv.experiment_id, variant: pv.variant };
    }
  }
  return null;
}

/**
 * Write the served page version into the dataLayer before GTM loads, so `page_view`
 * and every later event can read `experiment_id` / `variant` (no event is pushed).
 * Replaces any previous copy; removes it when the page has no version.
 */
export function injectPageVersionDataLayer(html: string, payload: unknown): string {
  const stripped = html.replace(PAGE_VERSION_SCRIPT_RE, "");
  const pv = pageVersionFromPayload(payload);
  if (!pv) return stripped;
  const json = JSON.stringify({ experiment_id: pv.experiment_id, variant: pv.variant }).replace(/</g, "\\u003c");
  const tag = `<script id="__AB_PAGE_VERSION__">window.dataLayer=window.dataLayer||[];window.dataLayer.push(${json});</script>\n`;
  return stripped.includes(GTM_MARKER) ? insertBefore(stripped, GTM_MARKER, tag) : insertBefore(stripped, "</head>", tag);
}

const PAGE_TRACKING_SCRIPT_RE = /<script id="__PAGE_TRACKING__">[\s\S]*?<\/script>\n?/g;

/** `_tracking` seeded on the page query, if any. */
export function pageTrackingFromPayload(payload: unknown): Record<string, string | boolean> | null {
  const queries = (payload as { queries?: Array<{ data?: unknown }> } | null)?.queries;
  if (!Array.isArray(queries)) return null;
  for (const q of queries) {
    const t = (q?.data as { _tracking?: unknown } | undefined)?._tracking;
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    const out: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(t as Record<string, unknown>)) {
      if (typeof v === "string" || typeof v === "boolean") out[k] = v;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}

/**
 * Write the page's product / persona tracking values into the dataLayer before GTM loads, so
 * the first `page_view` carries them (no event is pushed). Replaces any previous copy.
 */
export function injectPageTrackingDataLayer(html: string, payload: unknown): string {
  const stripped = html.replace(PAGE_TRACKING_SCRIPT_RE, "");
  const tracking = pageTrackingFromPayload(payload);
  if (!tracking) return stripped;
  const json = JSON.stringify(tracking).replace(/</g, "\\u003c");
  const tag = `<script id="__PAGE_TRACKING__">window.dataLayer=window.dataLayer||[];window.dataLayer.push(${json});</script>\n`;
  return stripped.includes(GTM_MARKER) ? insertBefore(stripped, GTM_MARKER, tag) : insertBefore(stripped, "</head>", tag);
}

/** `<script id="__INITIAL_DATA__">` with `<` escaped so content can never close the tag. */
export function buildInitialDataScriptTag(payload: unknown): string {
  let body = payload;
  if (body && typeof body === "object" && "skipHtmlCache" in body) {
    const { skipHtmlCache: _skip, ...rest } = body as Record<string, unknown>;
    body = rest;
  }
  return `<script id="__INITIAL_DATA__" type="application/json">${JSON.stringify(body).replace(/</g, "\\u003c")}</script>`;
}
