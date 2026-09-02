/**
 * Dev-only: replace the local event log with rows fetched from production.
 * All imported rows are marked published so the outbox dispatcher is not woken.
 */

import { getSiteContextMap } from "../site-manager";
import type { ContentEvent } from "./types";
import { replaceEventsFromSnapshot } from "./event-store";

const PAGE_LIMIT = 500;
const MAX_EVENTS = 5_000;

export type PullProductionEventsResult = {
  success: boolean;
  pulled: boolean;
  productionOrigin: string;
  imported: number;
  reason?: string;
};

/** Resolve https origin for the production host serving this content folder. */
export function resolveProductionOrigin(site: string): string | null {
  const fromEnv = process.env.PRODUCTION_SITE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  for (const ctx of getSiteContextMap().values()) {
    if (
      ctx.contentRootName === site ||
      ctx.config.contentFolder === site ||
      ctx.contentRoot.endsWith(`/${site}`)
    ) {
      return `https://${ctx.config.domain}`;
    }
  }
  return null;
}

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
  token: string | null,
): Promise<{ events: ContentEvent[]; reason?: string }> {
  if (!token) {
    return {
      events: [],
      reason:
        "Staff login required — log in with your Breathecode token so production can authorize the download.",
    };
  }

  const collected: ContentEvent[] = [];
  let before: number | undefined;

  while (collected.length < MAX_EVENTS) {
    const url = new URL("/api/admin/events", productionOrigin);
    url.searchParams.set("site", site);
    url.searchParams.set("limit", String(PAGE_LIMIT));
    if (before != null) url.searchParams.set("before", String(before));

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: { Authorization: `Token ${token}` },
      });
    } catch (err) {
      return {
        events: collected,
        reason:
          err instanceof Error
            ? `Could not reach production (${err.message})`
            : "Could not reach production.",
      };
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        events: collected,
        reason: `Production returned HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      };
    }

    const page = parseEventsPayload(await res.json());
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
  token: string | null,
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

  const { events, reason } = await fetchProductionEvents(productionOrigin, site, token);
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
