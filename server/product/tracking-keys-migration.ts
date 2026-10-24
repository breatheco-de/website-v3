/**
 * Migration 009: give every existing product and persona a tracking short key, then push
 * the changed `_product.yml` files to the site's content repo.
 */

import { assignMissingShortKeys } from "./tracking-keys-assign";

type Log = (...args: unknown[]) => void;

export type TrackingKeysMigrationDeps = {
  sites: () => Array<{ name: string; contentRoot: string }>;
  /** Content-root-relative files with unpushed local changes. */
  pending: (site: string) => string[];
  markModified: (file: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
  /** Clear cached pages + re-check the tracking switch in the live process (no-op in scripts). */
  afterWrite?: (contentRoot: string) => void;
};

async function defaultDeps(): Promise<TrackingKeysMigrationDeps> {
  const { getSiteContextMap } = await import("../site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("../sync-state");
  const { commitAndPush } = await import("../github");
  return {
    sites: () => Array.from(getSiteContextMap().values()).map((c) => ({ name: c.contentRootName, contentRoot: c.contentRoot })),
    pending: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local")
        .map((c) => c.file),
    markModified: (file, contentRoot) => {
      markFileAsModified(file, "migration:009", undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site, onlyBlockOnOverlap: true }),
  };
}

const isProductFile = (f: string) => /(^|\/)_product\.ya?ml$/.test(f);

export async function runTrackingKeysMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: TrackingKeysMigrationDeps;
}): Promise<{ failed: boolean }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const deps = opts.deps ?? (await defaultDeps());
  let failed = false;
  let matched = false;

  for (const s of deps.sites()) {
    if (opts.site && s.name !== opts.site) continue;
    matched = true;
    log("site", s.name);

    const push = async (files: string[], message: string): Promise<boolean> => {
      const withPrefix = files.map((f) => (f.startsWith(`${s.name}/`) ? f : `${s.name}/${f}`));
      const res = await deps.push(s.name, withPrefix, message);
      if (!res.success || !res.commitHash) {
        error("push_failed", res.error ?? "no commit SHA returned");
        error("files", withPrefix);
        return false;
      }
      log("commitSha", res.commitHash);
      return true;
    };

    // Recovery: product files written by an interrupted run but never pushed.
    const leftover = deps.pending(s.name).filter(isProductFile);

    const result = assignMissingShortKeys(s.contentRoot, { dryRun: opts.dryRun });
    for (const e of result.errors) {
      error("blocked", `${e.product}: ${e.error}`);
      failed = true;
    }
    if (result.assigned.length === 0) {
      log("nothing_to_assign", "every product and persona already has a tracking key");
    }
    for (const a of result.assigned) {
      log(
        opts.dryRun ? "would_assign" : "assigned",
        a.type === "product" ? `product ${a.product} (${a.name}) = ${a.key}` : `persona ${a.product}/${a.persona} (${a.name}) = ${a.key}`,
      );
    }
    if (opts.dryRun) {
      if (leftover.length) log("would_push_leftover", leftover);
      continue;
    }

    for (const file of result.files) deps.markModified(file, s.contentRoot);
    if (result.files.length) deps.afterWrite?.(s.contentRoot);
    const files = Array.from(new Set([...leftover.map((f) => f.replace(new RegExp(`^${s.name}/`), "")), ...result.files]));
    if (files.length === 0) continue;
    if (!(await push(files, "Tracking keys: give every product and persona a short code for analytics"))) failed = true;
  }

  if (opts.site && !matched) {
    error("site_not_found", opts.site);
    failed = true;
  }
  return { failed };
}
