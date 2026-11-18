/**
 * Preview which landings would be affected if staff save new account_locations maps.
 * Used by Settings → Ads confirm dialog (edge 3b).
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  accountLocationSet,
  anyAccountRestricted,
  deliverableAccountsForLanding,
  landingLocationsMismatchAccount,
  parseAccountLocationsMap,
  type AccountLocationsMap,
} from "@shared/adsAccountLocations";
import { pageLocationValues } from "@shared/formLocationPolicy";
import { getDefaultContentRoot } from "../site-config";
import { getContentTypeConfig } from "../content-types";
import { loadAdsSetup } from "./ads-setup";
import { catalogToDeliverableRefs } from "../ads-account-location-gate";
import { locationNameIndex } from "../location-catalog";
import { filterAccountLocationsToKnown } from "@shared/adsAccountLocations";

export type AffectedLanding = {
  slug: string;
  path: string;
  reasons: string[];
};

function readCommonLocations(commonPath: string): string[] {
  try {
    const raw = yaml.load(fs.readFileSync(commonPath, "utf-8")) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return [];
    return pageLocationValues(raw, "locations");
  } catch {
    return [];
  }
}

function listLandingSlugs(contentRoot: string): string[] {
  const cfg = getContentTypeConfig("landing", contentRoot) as { directory?: string } | null;
  const dirName = cfg?.directory || "landings";
  const dir = path.join(contentRoot, dirName);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("."))
    .map((d) => d.name);
}

/**
 * Landings that would newly warn (mismatch / missing) or hit the multi-account publish rule
 * under the proposed Meta/Google maps.
 */
export function previewAdsLocationSaveImpact(opts: {
  contentRoot?: string;
  platform: "meta" | "google";
  /** Proposed map for this platform (raw from UI). */
  account_locations: unknown;
  /** Connected account ids for this platform. */
  account_ids: string[];
}): { affected: AffectedLanding[]; restricted: boolean } {
  const contentRoot = opts.contentRoot || getDefaultContentRoot();
  const site = path.basename(contentRoot);
  const known = locationNameIndex(contentRoot).known;
  let proposed = parseAccountLocationsMap(opts.account_locations, opts.account_ids);
  proposed = filterAccountLocationsToKnown(proposed, known);

  const restricted = anyAccountRestricted(proposed);
  if (!restricted) return { affected: [], restricted: false };

  const catalog = loadAdsSetup(site, opts.platform);
  const refs = catalogToDeliverableRefs(catalog);
  const names: Record<string, string> = {};
  for (const [id, a] of Object.entries(catalog.accounts)) names[id] = a.name || id;

  const affected: AffectedLanding[] = [];
  for (const slug of listLandingSlugs(contentRoot)) {
    const landingPath = `/landing/${slug}`;
    const commonPath = path.join(contentRoot, "landings", slug, "_common.yml");
    const locations = fs.existsSync(commonPath) ? readCommonLocations(commonPath) : [];
    const reasons: string[] = [];

    const deliverableAccounts = deliverableAccountsForLanding(refs, landingPath);
    if (deliverableAccounts.length >= 2) {
      const label = deliverableAccounts.map((id) => names[id] || id).join(" and ");
      reasons.push(`Live ads from more than one account (${label}) already point here — publishing would be blocked.`);
    }

    for (const accountId of deliverableAccounts) {
      const set = accountLocationSet(proposed, accountId);
      if (set === null) continue;
      if (locations.length === 0) {
        reasons.push(
          `${names[accountId] || accountId} is limited to specific campuses, but this page has no Locations set (Ads warning).`,
        );
      } else if (landingLocationsMismatchAccount(locations, set)) {
        reasons.push(
          `${names[accountId] || accountId} is limited to campuses that do not match this page's Locations (Ads warning).`,
        );
      }
    }

    if (reasons.length) {
      affected.push({ slug, path: landingPath, reasons: Array.from(new Set(reasons)) });
    }
  }

  affected.sort((a, b) => a.slug.localeCompare(b.slug));
  return { affected, restricted };
}

export type { AccountLocationsMap };
