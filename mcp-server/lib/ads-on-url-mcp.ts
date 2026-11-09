/**
 * MCP warnings for ads that send people to a URL that is renamed, deleted or unpublished.
 * Server payloads carry `{ live, paused, checked, sources? }` (ad facts: platform, site,
 * campaign_name, ad_name, status, matched_by, url).
 */

import type { McpWarning } from "./respond.js";

type AdFact = { platform?: string | null; campaign_name?: string | null };
export type AdsOnUrlPayload = {
  live?: AdFact[];
  paused?: AdFact[];
  checked?: boolean;
  sources?: Array<{ platform?: string; fetched_at?: string | null }>;
};

function byPlatform(ads: AdFact[]): string {
  const counts = new Map<string, number>();
  for (const a of ads) {
    const p = a.platform || "other";
    counts.set(p, (counts.get(p) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([p, n]) => `${p} ${n}`)
    .join(", ");
}

function readAt(payload: AdsOnUrlPayload): string {
  const dates = (payload.sources ?? []).map((s) => s.fetched_at).filter((d): d is string => !!d).sort();
  return dates.length ? ` Ad data read ${dates.at(-1)!.slice(0, 10)}.` : "";
}

const MATCH_NOTE = "Matched by ad link or by tagged visits in the last 14 days; live = active and spent or created in the last 7 days.";

/**
 * - rename: live ads now rely on the redirect; paused ads would too.
 * - delete / unpublish: live ads now hit a missing page unless a destination was set.
 */
export function adsOnUrlWarnings(
  payload: AdsOnUrlPayload | null | undefined,
  context: "rename" | "delete" | "unpublish",
  opts: { url?: string | null; redirected?: boolean } = {},
): McpWarning[] {
  if (!payload) return [];
  const out: McpWarning[] = [];
  const where = opts.url ? ` ${opts.url}` : " the old URL";
  if (payload.checked === false) {
    out.push({
      code: "ads_check_unavailable",
      message: `Could not check ads for${where}: no ad data has been read for this site. Ads may still point there.`,
    });
    return out;
  }
  const live = payload.live ?? [];
  const paused = payload.paused ?? [];
  if (live.length > 0) {
    if (context === "rename" || opts.redirected) {
      out.push({
        code: "ads_rely_on_redirect",
        message:
          `${live.length} live ad(s) (${byPlatform(live)}) use${where}; they now reach the page through the redirect (gclid/fbclid/UTM kept). ` +
          `Ads are not edited in Meta/Google; staff can update their links to stop relying on the redirect. ${MATCH_NOTE}${readAt(payload)}`,
      });
    } else {
      out.push({
        code: "live_ads_point_to_url",
        message:
          `${live.length} live ad(s) (${byPlatform(live)}) send people to${where}, which ${context === "delete" ? "is deleted" : "is now a draft (404)"}. ` +
          `Paid traffic lands on a missing page until the ads are paused or their links changed in Meta/Google. ${MATCH_NOTE}${readAt(payload)}`,
      });
    }
  }
  if (paused.length > 0) {
    out.push({
      code: "paused_ads_point_to_url",
      message:
        `${paused.length} paused ad(s) (${byPlatform(paused)}) use${where}. If turned back on they ` +
        `${context === "rename" || opts.redirected ? "rely on the redirect" : "land on a missing page"}.${readAt(payload)}`,
    });
  }
  return out;
}
