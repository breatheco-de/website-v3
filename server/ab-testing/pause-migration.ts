/**
 * Migration 008: pause every page test (all variant allocations → 0%) so that completing
 * A/B testing setup does not silently restart old tests at their old splits.
 * The hidden A/B check page is skipped.
 */

import fs from "fs";
import path from "path";
import * as yaml from "js-yaml";
import { isAbCheckPage } from "./state";
import { listVersioningFiles, readVersioningYaml } from "./active-tests";

type Log = (...args: unknown[]) => void;

export type PauseMigrationDeps = {
  sites: () => Array<{ name: string; contentRoot: string }>;
  pending: (site: string) => string[];
  markModified: (absFile: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
};

async function defaultDeps(): Promise<PauseMigrationDeps> {
  const { getSiteContextMap } = await import("../site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("../sync-state");
  const { commitAndPush } = await import("../github");
  return {
    sites: () => Array.from(getSiteContextMap().values()).map((c) => ({ name: c.contentRootName, contentRoot: c.contentRoot })),
    pending: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local")
        .map((c) => c.file),
    markModified: (absFile, contentRoot) => {
      markFileAsModified(absFile, "migration:008", undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site, onlyBlockOnOverlap: true }),
  };
}

/** Allocations set to 0%; returns null when nothing has traffic. */
export function pauseVersioningData(
  data: Record<string, { variants?: Array<{ slug: string; allocation: number }> } & Record<string, unknown>>,
): { data: typeof data; paused: Array<{ locale: string; slug: string; was: number }> } | null {
  const paused: Array<{ locale: string; slug: string; was: number }> = [];
  const next: typeof data = {};
  for (const [locale, block] of Object.entries(data)) {
    const variants = Array.isArray(block?.variants) ? block.variants : [];
    next[locale] = {
      ...block,
      variants: variants.map((v) => {
        if (v.allocation > 0) paused.push({ locale, slug: v.slug, was: v.allocation });
        return { ...v, allocation: 0 };
      }),
    };
  }
  return paused.length ? { data: next, paused } : null;
}

export async function runPauseAbTestsMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: PauseMigrationDeps;
}): Promise<{ failed: boolean; changed: number }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const deps = opts.deps ?? (await defaultDeps());
  const rootOf = (contentRoot: string) => (path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot));
  let failed = false;
  let matched = false;
  let changed = 0;

  for (const s of deps.sites()) {
    if (opts.site && s.name !== opts.site) continue;
    matched = true;
    log("site", s.name);
    const root = rootOf(s.contentRoot);
    const files: string[] = [];
    const repoPath = (rel: string) => `${s.name}/${rel.replace(/\\/g, "/")}`;

    // Recovery: versioning.yml files changed by an earlier run but not pushed.
    const pending = deps.pending(s.name).filter((f) => f.endsWith("/versioning.yml"));

    for (const ref of listVersioningFiles(root)) {
      if (isAbCheckPage(ref.contentType, ref.slug, root)) continue;
      const data = readVersioningYaml(ref.absPath);
      if (!data) continue;
      const plan = pauseVersioningData(data as Parameters<typeof pauseVersioningData>[0]);
      if (!plan) continue;
      changed += 1;
      log("pause", ref.file, plan.paused.map((p) => `${p.locale}:${p.slug} ${p.was}%→0%`).join(", "));
      if (opts.dryRun) continue;
      fs.writeFileSync(ref.absPath, yaml.dump(plan.data, { indent: 2, lineWidth: 120, quotingType: '"', forceQuotes: false }), "utf-8");
      deps.markModified(ref.absPath, s.contentRoot);
      files.push(repoPath(ref.file));
    }

    for (const f of pending) if (!files.includes(f)) files.push(f);
    if (pending.length) log("recovery", "pushing versioning.yml left by an interrupted run", pending);

    if (opts.dryRun || files.length === 0) {
      if (!opts.dryRun) log("nothing_to_do");
      continue;
    }
    const res = await deps.push(s.name, files, "A/B testing: pause all page tests until A/B testing is set up");
    if (!res.success || !res.commitHash) {
      error("push_failed", res.error ?? "no commit SHA returned");
      error("files", files);
      failed = true;
      continue;
    }
    log("commitSha", res.commitHash);
  }

  if (opts.site && !matched) {
    error("site_not_found", opts.site);
    failed = true;
  }
  return { failed, changed };
}
