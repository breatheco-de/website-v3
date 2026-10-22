/**
 * Data migration 005: fix internal links that do not reach a live page, so the internal-link
 * gate can start blocking. Per broken link, in order:
 *   1. The same slug is live under another category → rewrite to that URL.
 *   2. The link redirects to a live page → rewrite to the final URL.
 *   3. Otherwise → remove the link, keep its anchor text (URL fields are emptied).
 * Bare paths in prose (no anchor text) and database rows are reported for a human, never edited.
 * Files are edited as text so formatting and comments stay as they are.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import type { ContentIndex } from "./content-index";
import { extractInternalLinkHits, type InternalLinkKind } from "./internal-link-hits";
import { evaluateInternalLinks } from "./internal-link-gate";

type Log = (...args: unknown[]) => void;

export const MIGRATION_AUTHOR = "migration:005";

export type LinkFixAction = "rewrite" | "unlink" | "clear_field" | "manual";

export type LinkFix = {
  field_path: string;
  kind: InternalLinkKind;
  link: string;
  action: LinkFixAction;
  to?: string;
  reason: "same_slug_other_category" | "redirect" | "no_live_match" | "draft_target" | "bare_path";
};

const LIVE_LOCALE_FILE_RE = /^([a-z]{2}(?:-[a-z]{2})?)\.ya?ml$/;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lastSegment(p: string): string {
  const parts = p.split(/[?#]/)[0]!.replace(/\/$/, "").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/** Keep the query / hash of the original link when rewriting its path. */
function withSuffix(link: string, to: string): string {
  const idx = link.search(/[?#]/);
  return idx >= 0 ? `${to}${link.slice(idx)}` : to;
}

function fieldKey(fieldPath: string): string {
  const parts = fieldPath.replace(/\[\d+\]/g, "").split(".");
  return parts[parts.length - 1] ?? "";
}

/** Pure: what to do with each problem link found in one file's data. */
export function planLinkFixes(input: {
  data: Record<string, unknown>;
  locale: string;
  ci: ContentIndex;
  contentRoot?: string;
}): LinkFix[] {
  const evaluation = evaluateInternalLinks({
    pageData: input.data,
    locale: input.locale,
    ci: input.ci,
    contentRoot: input.contentRoot,
  });
  const hitsByKey = new Map(
    extractInternalLinkHits(input.data).map((h) => [`${h.fieldPath}\u0000${h.link}`, h] as const),
  );
  const kindOf = (fieldPath: string, link: string): InternalLinkKind =>
    hitsByKey.get(`${fieldPath}\u0000${link}`)?.kind ?? "markdown";

  const fixes: LinkFix[] = [];
  const removal = (kind: InternalLinkKind): LinkFixAction =>
    kind === "bare" ? "manual" : kind === "field" ? "clear_field" : "unlink";

  for (const r of evaluation.redirected) {
    if (/^https?:\/\//i.test(r.final_url)) continue;
    const kind = kindOf(r.field_path, r.link);
    fixes.push({ field_path: r.field_path, kind, link: r.link, action: "rewrite", to: withSuffix(r.link, r.final_url), reason: "redirect" });
  }
  for (const b of evaluation.broken) {
    const kind = kindOf(b.field_path, b.link);
    const match = b.closest_live_match;
    if (match && lastSegment(match) === lastSegment(b.link)) {
      fixes.push({ field_path: b.field_path, kind, link: b.link, action: "rewrite", to: withSuffix(b.link, match), reason: "same_slug_other_category" });
      continue;
    }
    const action = removal(kind);
    fixes.push({ field_path: b.field_path, kind, link: b.link, action, reason: action === "manual" ? "bare_path" : "no_live_match" });
  }
  for (const d of evaluation.draftTargets) {
    const kind = kindOf(d.field_path, d.link);
    const action = removal(kind);
    fixes.push({ field_path: d.field_path, kind, link: d.link, action, reason: action === "manual" ? "bare_path" : "draft_target" });
  }
  return fixes;
}

function applyOne(text: string, fix: LinkFix): string {
  const link = escapeRe(fix.link);
  switch (fix.kind) {
    case "markdown":
      if (fix.action === "rewrite") {
        return text.replace(new RegExp(`\\]\\(\\s*${link}(?=(?:\\s+"[^"]*")?\\s*\\))`, "g"), `](${fix.to}`);
      }
      return text.replace(
        new RegExp(`(?<!!)\\[((?:[^\\[\\]]|\\[[^\\]]*\\])*)\\]\\(\\s*${link}(?:\\s+"[^"]*")?\\s*\\)`, "g"),
        "$1",
      );
    case "href":
      if (fix.action === "rewrite") {
        return text.replace(new RegExp(`(href\\s*=\\s*\\\\?["']?)${link}(?=\\\\?["'\\s>])`, "gi"), `$1${fix.to}`);
      }
      return text.replace(
        new RegExp(`<a\\b[^>]*\\bhref\\s*=\\s*\\\\?["']?${link}\\\\?["']?[^>]*>([\\s\\S]*?)</a>`, "gi"),
        "$1",
      );
    case "field": {
      const key = escapeRe(fieldKey(fix.field_path));
      const re = new RegExp(`^(\\s*(?:-\\s+)?${key}:\\s*)(["']?)${link}\\2(\\s*(?:#.*)?)$`, "gm");
      return text.replace(re, (_m, pre: string, q: string, post: string) =>
        fix.action === "rewrite" ? `${pre}${q}${fix.to}${q}${post}` : `${pre}""${post}`,
      );
    }
    case "bare":
      if (fix.action !== "rewrite") return text;
      return text.replace(new RegExp(`(^|\\s)${link}(?=[\\s.,;:!?'"]|$)`, "gm"), `$1${fix.to}`);
  }
}

/**
 * Pure: apply fixes to a YAML file's text. Fixes whose pattern is not found stay in `skipped`
 * (the link is written in a shape this migration does not edit). The result must still parse.
 */
export function applyLinkFixesToText(
  text: string,
  fixes: LinkFix[],
  parse: (text: string) => unknown = (t) => yaml.load(t),
): { text: string; applied: LinkFix[]; skipped: LinkFix[]; parseError?: string } {
  let out = text;
  const applied: LinkFix[] = [];
  const skipped: LinkFix[] = [];
  const done = new Set<string>();
  const sameEdit = (f: LinkFix) => `${f.kind}\u0000${f.action}\u0000${f.link}\u0000${f.to ?? ""}`;
  for (const fix of fixes) {
    if (fix.action === "manual") {
      skipped.push(fix);
      continue;
    }
    const next = applyOne(out, fix);
    if (next !== out) {
      applied.push(fix);
      done.add(sameEdit(fix));
      out = next;
    } else if (done.has(sameEdit(fix))) {
      // Every occurrence of this link was already replaced by an earlier fix in this file.
      applied.push(fix);
    } else {
      skipped.push(fix);
    }
  }
  if (out !== text) {
    try {
      parse(out);
    } catch (err) {
      return { text, applied: [], skipped: fixes, parseError: err instanceof Error ? err.message.split("\n")[0]! : String(err) };
    }
  }
  return { text: out, applied, skipped };
}

export type BrokenLinksMigrationSite = {
  name: string;
  contentRoot: string;
  ci: ContentIndex;
};

export type BrokenLinksMigrationDeps = {
  sites: () => BrokenLinksMigrationSite[];
  /** Local files changed by an earlier run of this migration and not pushed yet. */
  pendingFromMigration: (site: string) => string[];
  markModified: (absPath: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
  /** Database-backed pages (report only). */
  dbPages: (site: BrokenLinksMigrationSite) => Array<{ contentType: string; slug: string; locale: string; item: Record<string, unknown> }>;
};

async function defaultDeps(): Promise<BrokenLinksMigrationDeps> {
  const { getSiteContextMap } = await import("./site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("./sync-state");
  const { commitAndPush } = await import("./github");
  const { listTypePages } = await import("./entry-layer");
  return {
    sites: () =>
      Array.from(getSiteContextMap().values()).map((c) => ({
        name: c.contentRootName,
        contentRoot: c.contentRoot,
        ci: c.contentIndex,
      })),
    pendingFromMigration: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local" && c.author === MIGRATION_AUTHOR)
        .map((c) => c.file),
    markModified: (absPath, contentRoot) => {
      markFileAsModified(absPath, MIGRATION_AUTHOR, undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site, onlyBlockOnOverlap: true }),
    dbPages: (site) => {
      const out: Array<{ contentType: string; slug: string; locale: string; item: Record<string, unknown> }> = [];
      for (const contentType of site.ci.getContentTypes()) {
        try {
          for (const p of listTypePages(site.ci, contentType)?.pages ?? []) {
            out.push({ contentType, slug: p.slug, locale: p.locale, item: p.item as Record<string, unknown> });
          }
        } catch {
          /* database cache unavailable: nothing to report */
        }
      }
      return out;
    },
  };
}

/** Live YAML files of every content type: `_common.yml` and `{locale}.yml` per entry folder. */
export function listLiveYamlFiles(ci: ContentIndex, absRoot: string): Array<{ absPath: string; locale: string }> {
  const out: Array<{ absPath: string; locale: string }> = [];
  const seenDirs = new Set<string>();
  for (const contentType of ci.getContentTypes()) {
    const folder = ci.getContentTypeConfig(contentType)?.directory || contentType;
    const typeDir = path.join(absRoot, folder);
    if (seenDirs.has(typeDir) || !fs.existsSync(typeDir)) continue;
    seenDirs.add(typeDir);
    for (const slugDir of fs.readdirSync(typeDir, { withFileTypes: true })) {
      if (!slugDir.isDirectory() || slugDir.name.startsWith(".")) continue;
      const entryDir = path.join(typeDir, slugDir.name);
      for (const f of fs.readdirSync(entryDir)) {
        const m = LIVE_LOCALE_FILE_RE.exec(f);
        if (m) out.push({ absPath: path.join(entryDir, f), locale: m[1]! });
        else if (f === "_common.yml") out.push({ absPath: path.join(entryDir, f), locale: "en" });
      }
    }
  }
  return out;
}

function describe(fix: LinkFix): string {
  const target = fix.to ? ` → ${fix.to}` : "";
  return `${fix.action} ${fix.link}${target} (${fix.kind} at ${fix.field_path}; ${fix.reason})`;
}

export async function runBrokenLinksMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: BrokenLinksMigrationDeps;
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
    const absRoot = path.isAbsolute(s.contentRoot) ? s.contentRoot : path.join(process.cwd(), s.contentRoot);
    const relForPush = (abs: string) => `${s.name}/${path.relative(absRoot, abs).split(path.sep).join("/")}`;

    const push = async (files: string[], message: string): Promise<boolean> => {
      const res = await deps.push(s.name, files, message);
      if (!res.success || !res.commitHash) {
        error("push_failed", res.error ?? "no commit SHA returned");
        error("files", files);
        return false;
      }
      log("commitSha", res.commitHash);
      return true;
    };

    const leftover = deps.pendingFromMigration(s.name);
    if (leftover.length > 0) {
      log("recovery", "pushing files an earlier run changed but did not push", leftover);
      if (!opts.dryRun && !(await push(leftover, "Fix broken internal links (push files left by an interrupted run)"))) {
        failed = true;
        continue;
      }
    }

    const changed: string[] = [];
    let appliedCount = 0;
    let manualCount = 0;
    for (const file of listLiveYamlFiles(s.ci, absRoot)) {
      const text = fs.readFileSync(file.absPath, "utf-8");
      const parse = (t: string) => s.ci.safeYamlLoad(t);
      let data: Record<string, unknown>;
      try {
        data = (parse(text) as Record<string, unknown>) || {};
      } catch (err) {
        error("unreadable_yaml", relForPush(file.absPath), err instanceof Error ? err.message.split("\n")[0] : String(err));
        continue;
      }
      if (!data || typeof data !== "object") continue;
      const fixes = planLinkFixes({ data, locale: file.locale, ci: s.ci, contentRoot: s.contentRoot });
      if (fixes.length === 0) continue;

      const result = applyLinkFixesToText(text, fixes, parse);
      const rel = relForPush(file.absPath);
      if (result.parseError) {
        error("fix_would_break_yaml", rel, result.parseError);
        failed = true;
        continue;
      }
      for (const fix of result.applied) log(opts.dryRun ? "would_fix" : "fix", rel, describe(fix));
      for (const fix of result.skipped) log("needs_human", rel, describe(fix));
      appliedCount += result.applied.length;
      manualCount += result.skipped.length;
      if (result.applied.length === 0) continue;
      if (!opts.dryRun) {
        fs.writeFileSync(file.absPath, result.text, "utf-8");
        deps.markModified(file.absPath, s.contentRoot);
      }
      changed.push(rel);
    }

    for (const page of deps.dbPages(s)) {
      const evaluation = evaluateInternalLinks({ pageData: page.item, locale: page.locale, ci: s.ci, contentRoot: s.contentRoot });
      for (const b of [...evaluation.broken, ...evaluation.draftTargets]) {
        manualCount++;
        log("needs_human_database", `${page.contentType}/${page.slug}/${page.locale}`, `${b.link} at ${b.field_path}`);
      }
    }

    log("summary", { files_changed: changed.length, links_fixed: appliedCount, needs_human: manualCount });
    if (changed.length === 0) {
      log("nothing_to_push", "no file needed an automatic fix");
      continue;
    }
    if (opts.dryRun) continue;
    if (!(await push(changed, `Fix broken internal links in ${changed.length} file(s) before the internal-link gate blocks`))) {
      failed = true;
    }
  }

  if (opts.site && !matched) {
    error("site_not_found", opts.site);
    failed = true;
  }
  return { failed };
}
