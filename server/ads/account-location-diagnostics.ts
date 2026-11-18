/**
 * Ads diagnostics: restricted ad accounts vs landing Locations (live catalog only).
 * Codes: account_landing_location_mismatch | account_landing_location_missing.
 * Clears after sync when ads pause / destinations change (verify: after_sync).
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  accountLocationSet,
  anyAccountRestricted,
  isDeliverableAd,
  landingLocationsMismatchAccount,
  normalizeLandingPathForMatch,
  type AccountLocationsMap,
  type DeliverableAdRef,
} from "@shared/adsAccountLocations";
import type { AdsIssue } from "@shared/ads-diagnostics-rules";
import { pageLocationValues } from "@shared/formLocationPolicy";
import { catalogToDeliverableRefs } from "../ads-account-location-gate";
import type { AdsSetupCatalog } from "./ads-setup";

export type PageLocationsLookup = (landingPath: string) => string[] | null;

function readCommonLocations(commonPath: string): string[] {
  try {
    const raw = yaml.load(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return [];
    return pageLocationValues(raw, "locations");
  } catch {
    return [];
  }
}

/** Default: read landings/{slug}/_common.yml under contentRoot. Returns null for non-landing paths. */
export function makeLandingPageLocationsLookup(contentRoot: string): PageLocationsLookup {
  return (landingPath: string) => {
    const m = normalizeLandingPathForMatch(landingPath).match(/^\/landing\/([a-z0-9-]+)$/);
    if (!m) return null;
    const commonPath = path.join(contentRoot, "landings", m[1]!, "_common.yml");
    if (!fs.existsSync(commonPath)) return null;
    return readCommonLocations(commonPath);
  };
}

type Hit = {
  account_id: string;
  account_name: string;
  path: string;
  page_locations: string[];
  account_locations: string[];
  kind: "mismatch" | "missing";
};

/**
 * Pure: emit warnings for deliverable ads from restricted accounts.
 * Unrestricted accounts and non-managed (non-landing / missing file) destinations are skipped.
 */
export function accountLocationDiagnosticIssues(input: {
  platform: "meta" | "google";
  account_locations: AccountLocationsMap;
  catalog: AdsSetupCatalog | null;
  /** Injected refs for tests (skips catalog flatten). */
  refs?: DeliverableAdRef[];
  account_names?: Record<string, string>;
  pageLocations: PageLocationsLookup;
}): AdsIssue[] {
  const map = input.account_locations;
  if (!anyAccountRestricted(map)) return [];

  const names: Record<string, string> = { ...(input.account_names ?? {}) };
  if (input.catalog) {
    for (const [id, a] of Object.entries(input.catalog.accounts)) names[id] = a.name || id;
  }

  const refs = input.refs ?? (input.catalog ? catalogToDeliverableRefs(input.catalog) : []);
  const hits = new Map<string, Hit>();

  for (const ad of refs) {
    if (!isDeliverableAd(ad)) continue;
    const set = accountLocationSet(map, ad.account_id);
    if (set === null) continue;

    for (const u of ad.landing_urls) {
      let pathOnly: string;
      try {
        pathOnly = normalizeLandingPathForMatch(u.includes("://") ? new URL(u).pathname : u);
      } catch {
        continue;
      }
      const pageLocs = input.pageLocations(pathOnly);
      if (pageLocs === null) continue; // not a managed landing we can check

      const account_name = names[ad.account_id] || ad.account_id;
      const account_locations = Array.from(set).sort();

      if (pageLocs.length === 0) {
        const key = `missing:${ad.account_id}:${pathOnly}`;
        if (!hits.has(key)) {
          hits.set(key, {
            account_id: ad.account_id,
            account_name,
            path: pathOnly,
            page_locations: [],
            account_locations,
            kind: "missing",
          });
        }
      } else if (landingLocationsMismatchAccount(pageLocs, set)) {
        const key = `mismatch:${ad.account_id}:${pathOnly}`;
        if (!hits.has(key)) {
          hits.set(key, {
            account_id: ad.account_id,
            account_name,
            path: pathOnly,
            page_locations: [...pageLocs].sort(),
            account_locations,
            kind: "mismatch",
          });
        }
      }
    }
  }

  const issues: AdsIssue[] = [];
  for (const hit of hits.values()) {
    const agentFix =
      "Agents: set or narrow the page's `locations` via update_fields. " +
      "Staff-only: Settings → Ads account locations, or pause campaigns in Ads Manager.";
    if (hit.kind === "missing") {
      issues.push({
        id: `account_landing_location_missing:${hit.account_id}:${hit.path}`,
        code: "account_landing_location_missing",
        platform: input.platform,
        severity: "warning",
        title: `Ad account limited, page has no Locations: ${hit.path}`,
        why:
          `${hit.account_name} (${hit.account_id}) is limited to ${hit.account_locations.join(", ")}, ` +
          `but live ads from that account point at ${hit.path}, which has no Locations set.`,
        how_to_fix:
          `Set Locations on this page to campuses this account serves (${hit.account_locations.join(", ")}). ${agentFix} ` +
          `After the next sync, the warning clears if ads pause or Locations are set.`,
        spend_affected: {},
        scope: { url: hit.path, page_key: hit.path, account_id: hit.account_id },
        site_fixable: true,
      });
    } else {
      issues.push({
        id: `account_landing_location_mismatch:${hit.account_id}:${hit.path}`,
        code: "account_landing_location_mismatch",
        platform: input.platform,
        severity: "warning",
        title: `Ad account locations don't match page: ${hit.path}`,
        why:
          `${hit.account_name} (${hit.account_id}) may only serve ${hit.account_locations.join(", ")}, ` +
          `but live ads point at ${hit.path} whose Locations are ${hit.page_locations.join(", ")} — no overlap.`,
        how_to_fix:
          `Change this page's Locations so they overlap the account's campuses, or ask staff to update Ads maps / pause ads. ${agentFix} ` +
          `After the next sync, the warning clears when ads pause or Locations overlap.`,
        spend_affected: {},
        scope: { url: hit.path, page_key: hit.path, account_id: hit.account_id },
        site_fixable: true,
      });
    }
  }

  return issues;
}
