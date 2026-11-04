/**
 * Staff actions behind the IndexNow and public URL change routes.
 * Routes stay thin; these take explicit deps so tests can drive them.
 */

import { randomBytes } from "crypto";
import { isLiveServer } from "./live-server";
import { getIndexNowSettings, updateIndexNowSettings, type IndexNowSettings } from "./settings";
import {
  INDEXNOW_CONSUMER,
  checkKeyFile,
  enqueueIndexNowSubmit,
  getSiteMainHost,
  resumeIndexNow,
  submitUrls,
  type IndexNowOutcome,
  type IndexNowSubmitResult,
  type KeyFileCheck,
} from "./indexnow";
import {
  countChangesAfter,
  countChangesSince,
  countChangesSinceUpTo,
  getConsumer,
  getMaxChangeId,
  listRecentChanges,
  releaseHeldDrop,
  updateConsumer,
  type PublicUrlChange,
} from "./public-url-changes/store";

type Deps = {
  live?: boolean;
  now?: number;
  checkKey?: (host: string, key: string) => Promise<KeyFileCheck>;
  submit?: (host: string, key: string, urls: string[]) => Promise<IndexNowSubmitResult>;
  enqueue?: typeof enqueueIndexNowSubmit;
};

export function generateIndexNowKey(): string {
  return randomBytes(16).toString("hex");
}

export type SaveIndexNowResult = { settings: IndexNowSettings; warnings: string[] };

export async function saveIndexNowSettingsForSite(
  opts: {
    site: string;
    contentRoot: string;
    input: { enabled?: boolean; key?: string; generateKey?: boolean };
  },
  deps: Deps = {},
): Promise<SaveIndexNowResult> {
  const { site, contentRoot, input } = opts;
  const before = getIndexNowSettings(contentRoot);
  const key = input.generateKey ? generateIndexNowKey() : input.key;
  const settings = updateIndexNowSettings({ enabled: input.enabled, key }, contentRoot);

  if (settings.key !== before.key) updateConsumer(site, INDEXNOW_CONSUMER, { verifiedAt: null });
  resumeIndexNow(site);

  const warnings: string[] = [];
  const host = getSiteMainHost(site);
  if (settings.enabled && settings.key) {
    if (!host) {
      warnings.push("This site has no public domain in sites.yml, so notices cannot be sent.");
    } else {
      const check = await (deps.checkKey ?? checkKeyFile)(host, settings.key);
      if (!check.ok) {
        warnings.push(
          `${check.detail} (${check.url}). Notices will be rejected until the live site serves the key: publish settings first.`,
        );
      }
    }
    const live = deps.live ?? isLiveServer();
    if (live) await (deps.enqueue ?? enqueueIndexNowSubmit)({ site, contentRoot });
  }
  return { settings, warnings };
}

export type IndexNowTestResult = {
  ok: boolean;
  mode: "notice" | "key_file";
  status?: number | null;
  outcome?: IndexNowOutcome;
  detail: string;
  url?: string;
};

export async function testIndexNowConnection(
  opts: { site: string; contentRoot: string },
  deps: Deps = {},
): Promise<IndexNowTestResult> {
  const { site, contentRoot } = opts;
  const settings = getIndexNowSettings(contentRoot);
  const host = getSiteMainHost(site);
  const live = deps.live ?? isLiveServer();
  if (!settings.key) {
    return { ok: false, mode: live ? "notice" : "key_file", detail: "Generate a key first" };
  }
  if (!host) {
    return { ok: false, mode: live ? "notice" : "key_file", detail: "This site has no public domain in sites.yml" };
  }

  if (!live) {
    const check = await (deps.checkKey ?? checkKeyFile)(host, settings.key);
    return {
      ok: check.ok,
      mode: "key_file",
      detail: check.ok ? check.detail : `Not yet: ${check.detail}. Publish settings first.`,
      url: check.url,
    };
  }

  const now = deps.now ?? Date.now();
  const result = await (deps.submit ?? submitUrls)(host, settings.key, [`https://${host}/`]);
  const ok = result.outcome === "accepted" || result.outcome === "accepted_pending_key";
  if (ok) {
    const consumer = getConsumer(site, INDEXNOW_CONSUMER);
    if (result.outcome === "accepted" && !consumer.verifiedAt) {
      updateConsumer(site, INDEXNOW_CONSUMER, { verifiedAt: now });
    }
    resumeIndexNow(site);
    if (settings.enabled) await (deps.enqueue ?? enqueueIndexNowSubmit)({ site, contentRoot });
  }
  return {
    ok,
    mode: "notice",
    status: result.status,
    outcome: result.outcome,
    detail: result.outcome === "accepted" ? "Notice accepted" : result.detail,
  };
}

export type SubmitAllResult = { queued: boolean; total: number; reason?: string };

export async function requestSubmitAll(
  opts: { site: string; contentRoot: string; total: number },
  deps: Deps = {},
): Promise<SubmitAllResult> {
  const live = deps.live ?? isLiveServer();
  if (!live) return { queued: false, total: opts.total, reason: "Only the live site sends notices" };
  const settings = getIndexNowSettings(opts.contentRoot);
  if (!settings.enabled || !settings.key) {
    return { queued: false, total: opts.total, reason: "Turn IndexNow on first" };
  }
  const queued = await (deps.enqueue ?? enqueueIndexNowSubmit)({
    site: opts.site,
    contentRoot: opts.contentRoot,
    mode: "all",
    allUpToChangeId: getMaxChangeId(opts.site),
    runAt: deps.now ?? Date.now(),
  });
  return { queued, total: opts.total };
}

/** Staff confirmed a held large drop. False when nothing is held (route answers 409). */
export function confirmHeldRemovals(site: string): boolean {
  return releaseHeldDrop(site);
}

export type StaffPublicUrlChange = PublicUrlChange & { sent: boolean };

export type StaffPublicUrlChanges = {
  changes: StaffPublicUrlChange[];
  summary: { changesThisWeek: number; sentThisWeek: number; waiting: number; bookmark: number };
};

export function toAbsolutePageUrl(site: string, pathOrUrl: string): string | null {
  const trimmed = pathOrUrl.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const host = getSiteMainHost(site);
  if (!host) return null;
  return `https://${host}${trimmed.startsWith("/") ? "" : "/"}${trimmed}`;
}

export function listPublicUrlChangesForStaff(
  opts: { site: string; limit?: number; path?: string },
  deps: Deps = {},
): StaffPublicUrlChanges {
  const now = deps.now ?? Date.now();
  const consumer = getConsumer(opts.site, INDEXNOW_CONSUMER);
  const url = opts.path ? toAbsolutePageUrl(opts.site, opts.path) : undefined;
  const rows = opts.path && !url ? [] : listRecentChanges(opts.site, { limit: opts.limit ?? 20, url: url ?? undefined });
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  return {
    changes: rows.map((c) => ({ ...c, sent: c.id <= consumer.lastChangeId })),
    summary: {
      changesThisWeek: countChangesSince(opts.site, weekAgo),
      sentThisWeek: countChangesSinceUpTo(opts.site, weekAgo, consumer.lastChangeId),
      waiting: countChangesAfter(opts.site, consumer.lastChangeId),
      bookmark: consumer.lastChangeId,
    },
  };
}
