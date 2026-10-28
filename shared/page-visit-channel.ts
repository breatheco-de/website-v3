/**
 * Channel of a landing visit in the page stats buckets (paid / organic / email / social /
 * referral / direct / other, as in the GA4 page queries). Classification is the shared
 * `classifyChannel` used by sessions and the lead ledger; this only maps its buckets.
 */

import { classifyChannel, type TrafficChannel } from "./traffic-channel";
import type { ClickIdParam } from "./paid-traffic";

export type PageStatsChannel = "paid" | "organic" | "email" | "social" | "referral" | "direct" | "other";

const TO_PAGE_STATS: Record<TrafficChannel, PageStatsChannel> = {
  paid: "paid",
  meta_unclear: "social",
  organic_search: "organic",
  organic_social: "social",
  ai_assistant: "referral",
  email: "email",
  referral: "referral",
  direct: "direct",
  tagged_other: "other",
};

export function pageStatsChannel(input: {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  clickIdType?: string | null;
  /** External referrer host (already known not to be our own). */
  referrerHost?: string | null;
}): PageStatsChannel {
  const click = input.clickIdType ? ({ [input.clickIdType as ClickIdParam]: "1" } as Partial<Record<ClickIdParam, string>>) : undefined;
  const channel = classifyChannel({
    utm: { utm_source: input.source ?? null, utm_medium: input.medium ?? null, utm_campaign: input.campaign ?? null },
    click_ids: click,
    referrer: input.referrerHost ? `https://${input.referrerHost}/` : null,
    ownHosts: [],
  });
  return channel ? TO_PAGE_STATS[channel] : "direct";
}
