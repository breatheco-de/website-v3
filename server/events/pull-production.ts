/**
 * Dev-only: replace the local event log with rows fetched from production.
 * All imported rows are marked published so the outbox dispatcher is not woken.
 */

import type { ContentEvent } from "./types";
import { replaceEventsFromSnapshot } from "./event-store";
import {
  fetchProductionAdmin,
  resolveProductionOrigin,
  type ProductionStaffTokenRequiredPayload,
} from "../dev-production-fetch";

export { resolveProductionOrigin } from "../dev-production-fetch";

const PAGE_LIMIT = 500;
const MAX_EVENTS = 5_000;

export type PullProductionEventsResult = {
  success: boolean;
  pulled: boolean;
  productionOrigin: string;
  imported: number;
  reason?: string;
} & Partial<ProductionStaffTokenRequiredPayload>;

function parseEventsPayload(body: unknown): ContentEvent[] {
  if (!body || typeof body !== "object") return [];
  const events = (body as { events?: unknown }).events;
  if (!Array.isArray(events)) return [];
  return events.filter(
    (ev): ev is ContentEvent =>
      typeof ev === "object" &&
      ev !== null &&
      typeof (ev as ContentEvent).id === "number" &&
      typeof (ev as ContentEvent).type === "string" &&
      typeof (ev as ContentEvent).created_at === "number",
  );
}

async function fetchProductionEvents(
  productionOrigin: string,
  site: string,
): Promise<{
  events: ContentEvent[];
  reason?: string;
  tokenRequired?: ProductionStaffTokenRequiredPayload;
}> {
  const collected: ContentEvent[] = [];
  let before: number | undefined;

  while (collected.length < MAX_EVENTS) {
    const url = new URL("/api/admin/events", productionOrigin);
    url.searchParams.set("site", site);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (before != null) url.searchParams.set("before", String(before));

    const result = await fetchProductionAdmin(url, { method: "GET" }, productionOrigin);

    if (!result.ok) {
      if (result.kind === "token_required") {
        return { events: collected, tokenRequired: result.payload, reason: result.payload.error };
      }
      if (result.kind === "network") {
        return { events: collected, reason: result.error };
      }
      return {
        events: collected,
        reason: `Production returned HTTP ${result.status}${
          result.body ? `: ${result.body.slice(0, 200)}` : ""
        }`,
      };
    }

    const page = parseEventsPayload(await result.response.json());
    if (page.length === 0) break;

    collected.push(...page);
    if (page.length < PAGE_LIMIT) break;

    const oldestId = page[page.length - 1]?.id;
    if (oldestId == null || oldestId <= 1) break;
    before = oldestId;
  }

  return { events: collected };
}

export async function pullProductionEvents(
  site: string,
  productionOriginOverride?: string,
): Promise<PullProductionEventsResult> {
  const productionOrigin =
    productionOriginOverride?.replace(/\/$/, "") || resolveProductionOrigin(site);

  if (!productionOrigin) {
    return {
      success: false,
      pulled: false,
      productionOrigin: "",
      imported: 0,
      reason:
        "Could not resolve production URL for this site. Set PRODUCTION_SITE_URL or configure the site domain in sites.yml.",
    };
  }

  const { events, reason, tokenRequired } = await fetchProductionEvents(productionOrigin, site);

  if (tokenRequired) {
    return {
      success: false,
      pulled: false,
      productionOrigin,
      imported: 0,
      reason: tokenRequired.error,
      ...tokenRequired,
    };
  }

  if (events.length === 0) {
    return {
      success: false,
      pulled: false,
      productionOrigin,
      imported: 0,
      reason: reason ?? "No events returned from production.",
    };
  }

  const imported = replaceEventsFromSnapshot(site, events);
  return {
    success: true,
    pulled: true,
    productionOrigin,
    imported,
  };
}
