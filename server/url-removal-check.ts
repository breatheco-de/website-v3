/**
 * Shared check before a page URL goes away (slug rename, delete, unpublish): the URL of each
 * affected locale, the ads that send people there, the A/B check page lock and the page's age
 * (agents must redirect or name a destination for pages live 24 hours or more).
 */

import fs from "fs";
import path from "path";
import { abCheckPageLock } from "./ab-testing/state";
import { adsOnUrl } from "./ads/ads-by-landing-page";
import type { ContentIndex } from "./content-index";
import { contentIndex } from "./content-index";
import { resolveEntryRef } from "./entry-ref";
import { ownHostsForContentRoot } from "./link-check/hosts";
import { entryAgeHours, readPublishedAtFromCommon, resolveCurrentLocaleUrl } from "./locale-url-slug";
import { child } from "./logger";
import {
  AGENT_REDIRECT_AGE_HOURS,
  emptyAdsOnUrl,
  type AdsOnUrlResult,
  type UrlRemovalAction,
  type UrlRemovalCheck,
  type UrlRemovalLocale,
} from "@shared/url-removal";

const log = child({ module: "url-removal-check" });

/** Ads pointing at a site-relative path on this site's domains; never throws. */
export function adsForSitePath(urlPath: string, ci: Pick<ContentIndex, "contentRoot" | "contentRootName">): AdsOnUrlResult {
  try {
    const hosts = ownHostsForContentRoot(ci.contentRootName || ci.contentRoot);
    return adsOnUrl(urlPath, hosts);
  } catch (err) {
    log.warn({ err, urlPath }, "[url-removal-check] ads lookup failed");
    return emptyAdsOnUrl();
  }
}

function liveLocalesInFolder(folderPath: string): string[] {
  if (!fs.existsSync(folderPath)) return [];
  return fs
    .readdirSync(folderPath)
    .filter((f) => /^[a-z]{2}(-[A-Za-z]{2,})?\.ya?ml$/.test(f))
    .map((f) => f.replace(/\.ya?ml$/, ""));
}

export async function assessUrlRemoval(input: {
  contentType: string;
  slug: string;
  /** Empty = every live locale of the entry. */
  locales?: string[];
  action: UrlRemovalAction;
  ci?: ContentIndex;
}): Promise<UrlRemovalCheck> {
  const ci = input.ci ?? contentIndex;
  const { contentType, action } = input;
  const page = resolveEntryRef(ci, { contentType, ref: input.slug });
  const entryId = page.ok ? page.entryId : ci.resolveBaseSlug(input.slug, contentType);
  const folderPath = ci.getContentFolderPath(contentType, entryId);
  const commonData = (ci.loadCommonData(contentType as never, entryId) ?? {}) as Record<string, unknown>;
  const ageHours = entryAgeHours(readPublishedAtFromCommon(commonData));
  const lock = abCheckPageLock(contentType, entryId, ci.contentRoot);

  const requested = (input.locales ?? []).filter(Boolean);
  const locales = requested.length > 0 ? requested : liveLocalesInFolder(folderPath);
  const out: UrlRemovalLocale[] = [];
  for (const raw of locales) {
    const candidates = contentType === "landing" && typeof commonData.locale === "string" ? [raw, commonData.locale] : [raw];
    let locale = raw;
    let file: string | undefined;
    for (const c of candidates) {
      file = [`${c}.yml`, `${c}.yaml`].map((f) => path.join(folderPath, f)).find((f) => fs.existsSync(f));
      if (file) {
        locale = c;
        break;
      }
    }
    if (!file) continue;
    let url: string | null = null;
    try {
      const parsed = ci.safeYamlLoad(fs.readFileSync(file, "utf-8")) ?? {};
      url = resolveCurrentLocaleUrl({ contentType, entryIdentity: entryId, locale, parsed, commonData, ci });
    } catch (err) {
      log.warn({ err, contentType, entryId, locale }, "[url-removal-check] could not build URL");
    }
    out.push({
      locale,
      url,
      ads: url ? adsForSitePath(url, ci) : emptyAdsOnUrl(),
      age_hours: ageHours,
      redirect_required_for_agents: (ageHours ?? 0) >= AGENT_REDIRECT_AGE_HOURS,
    });
  }

  return {
    action,
    contentType,
    slug: entryId,
    locales: out,
    ab_lock: lock,
    live_ads: out.reduce((n, l) => n + l.ads.live.length, 0),
    paused_ads: out.reduce((n, l) => n + l.ads.paused.length, 0),
    ads_checked: out.length === 0 ? adsForSitePath("/", ci).checked : out.some((l) => l.ads.checked),
  };
}

/** Every live ad across the check's locales (deduplicated by platform + id). */
export function liveAdsOf(check: Pick<UrlRemovalCheck, "locales">) {
  const seen = new Set<string>();
  const out: AdsOnUrlResult["live"] = [];
  for (const l of check.locales) {
    for (const a of l.ads.live) {
      const k = `${a.site}:${a.platform}:${a.ad_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
  }
  return out;
}

export function pausedAdsOf(check: Pick<UrlRemovalCheck, "locales">) {
  const seen = new Set<string>();
  const out: AdsOnUrlResult["paused"] = [];
  for (const l of check.locales) {
    for (const a of l.ads.paused) {
      const k = `${a.site}:${a.platform}:${a.ad_id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(a);
    }
  }
  return out;
}
