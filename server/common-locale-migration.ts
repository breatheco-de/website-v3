/**
 * Migration 012: remove the ignored top-level `locale:` line from `_common.yml` of one-address
 * pages (types whose url_pattern is only `default`, e.g. /landing/:slug). The language comes
 * from the language file whose slug matches the address; `_common.yml` `locale` is legacy.
 * Text edit only: every other byte of the file stays as it was.
 */
import fs from "fs";
import path from "path";
import { getAllConfigs } from "./content-types";
import { isSingleAddressPattern } from "./locale-url-slug";

type Log = (...args: unknown[]) => void;

const TOP_LEVEL_LOCALE = /^locale:[^\n]*(?:\r?\n|$)/m;

/** Remove the top-level `locale:` line (indented keys are untouched). */
export function removeCommonLocaleLine(text: string): { text: string; changed: boolean } {
  if (!TOP_LEVEL_LOCALE.test(text)) return { text, changed: false };
  return { text: text.replace(TOP_LEVEL_LOCALE, ""), changed: true };
}

/** `_common.yml` paths (relative to the app root) of one-address pages that still set `locale`. */
export function findCommonLocaleFiles(siteName: string, contentRootAbs: string): string[] {
  const out: string[] = [];
  const configs = getAllConfigs(contentRootAbs) as Record<string, { directory?: string; url_pattern?: Record<string, string>; database?: unknown }>;
  for (const [type, config] of Object.entries(configs)) {
    if (config?.database || !isSingleAddressPattern(config?.url_pattern)) continue;
    const dir = path.join(contentRootAbs, config.directory || type);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir).sort()) {
      const commonPath = path.join(dir, entry, "_common.yml");
      if (!fs.existsSync(commonPath)) continue;
      if (TOP_LEVEL_LOCALE.test(fs.readFileSync(commonPath, "utf-8"))) {
        out.push(`${siteName}/${config.directory || type}/${entry}/_common.yml`);
      }
    }
  }
  return out;
}

export type CommonLocaleMigrationDeps = {
  sites: () => Array<{ name: string; contentRoot: string }>;
  pending: (site: string) => string[];
  markModified: (file: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
};

async function defaultDeps(): Promise<CommonLocaleMigrationDeps> {
  const { getSiteContextMap } = await import("./site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("./sync-state");
  const { commitAndPush } = await import("./github");
  return {
    sites: () => Array.from(getSiteContextMap().values()).map((c) => ({ name: c.contentRootName, contentRoot: c.contentRoot })),
    pending: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local")
        .map((c) => c.file),
    markModified: (file, contentRoot) => {
      markFileAsModified(file, "migration:012", undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site, onlyBlockOnOverlap: true }),
  };
}

export async function runCommonLocaleMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: CommonLocaleMigrationDeps;
}): Promise<{ failed: boolean; changed: string[] }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const deps = opts.deps ?? (await defaultDeps());
  const rootOf = (contentRoot: string) => (path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot));
  let failed = false;
  let matched = false;
  const changed: string[] = [];

  for (const s of deps.sites()) {
    if (opts.site && s.name !== opts.site) continue;
    matched = true;
    log("site", s.name);
    const contentRootAbs = rootOf(s.contentRoot);

    // Recovery: `_common.yml` files an earlier run edited but did not push (no locale line left).
    const pending = deps.pending(s.name).filter((f) => f.endsWith("/_common.yml"));
    const leftover = pending.filter((f) => {
      const abs = path.join(process.cwd(), f);
      return fs.existsSync(abs) && !TOP_LEVEL_LOCALE.test(fs.readFileSync(abs, "utf-8"));
    });

    const files = findCommonLocaleFiles(s.name, contentRootAbs);
    if (files.length === 0 && leftover.length === 0) {
      log("nothing_to_do", "no one-address _common.yml sets locale");
      continue;
    }
    for (const f of files) log("remove_locale", f);
    if (leftover.length) log("recovery", `${leftover.length} file(s) edited by an earlier run but not pushed`);
    if (opts.dryRun) {
      changed.push(...files);
      continue;
    }

    for (const rel of files) {
      const abs = path.join(process.cwd(), rel);
      const result = removeCommonLocaleLine(fs.readFileSync(abs, "utf-8"));
      if (!result.changed) continue;
      fs.writeFileSync(abs, result.text, "utf-8");
      deps.markModified(rel, s.contentRoot);
      changed.push(rel);
    }

    const toPush = [...new Set([...leftover, ...changed.filter((f) => f.startsWith(`${s.name}/`))])];
    if (toPush.length === 0) continue;
    const res = await deps.push(
      s.name,
      toPush,
      `Remove ignored locale from _common.yml of one-address pages (${toPush.length} file(s)); language comes from the language file`,
    );
    if (!res.success || !res.commitHash) {
      error("push_failed", res.error ?? "no commit SHA returned");
      error("files", toPush);
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
