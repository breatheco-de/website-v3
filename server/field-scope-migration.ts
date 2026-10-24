/**
 * Data migration 006: every field lives once, in the file `FIELD_SCOPE` names.
 *
 * Per site, per entry folder:
 *   1. Drafts: page-level values the draft only copied from the live locale file (equal to
 *      the draft base, else today's live) are removed; values the author changed stay staged.
 *   2. Page-level fields in language files move to `_common.yml`; per-language fields in
 *      `_common.yml` (incl. meta.robots / priority / change_frequency) move into each language
 *      that lacks its own copy. When page-level copies (or search-setting copies) differ, the
 *      most recently set real value wins (value-level git history of the content repo). A
 *      language's own text (title, description, …) is never replaced by the `_common.yml`
 *      fallback. Without usable history, what visitors see today wins (flagged `no_history`);
 *      a winner from a commit touching many files is applied and flagged `bulk_change`.
 *      Empty placeholders never win.
 *   3. Drafts whose base / translation source matched live before are re-stamped so the
 *      cleanup does not make them look stale; linked proposals get the new draft fingerprint.
 *   4. Report: proposals linked to cleaned drafts that still have open needs-changes.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  LOCALE_META_KEYS,
  LOCALE_TOP_LEVEL_KEYS,
  splitByFieldScope,
  type FieldScopeOptions,
} from "@shared/field-scope";
import { cloneJson, deleteAtPath, getAtPath, isPlainObject, setAtPath } from "@shared/object-path";
import { deepMerge } from "./utils/deepMerge";
import { readDraftMeta, readVariantData, safeDumpYaml, safeLoadYaml, writeVariantFile } from "./versioning/draft-meta";
import {
  baseSnapshotOf,
  checkDraftBase,
  checkTranslationSource,
  recordDraftBase,
  recordTranslationSource,
  sameValue,
  scopeOptionsOf,
  type DraftRef,
} from "./versioning/draft-base";
import { scanEntries, type ScannedEntry } from "../scripts/validation/shared/draft-scan";

export const MIGRATION_AUTHOR = "migration:006";
/** A commit touching more files than this is a bulk change (seed / import / mass rewrite). */
export const BULK_COMMIT_FILES = 50;

type Doc = Record<string, unknown>;
type Log = (...args: unknown[]) => void;

// ── Values ───────────────────────────────────────────────────────────────────

/** Empty placeholders (`''`, `null`, `[]`, `{}`) are not a real value. */
export function isRealValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return true;
}

function sameShown(a: unknown, b: unknown): boolean {
  if (!isRealValue(a) && !isRealValue(b)) return true;
  return sameValue(a, b);
}

/** Top-level keys and `meta.*` keys of a split part, as field paths. */
function pathsOf(part: Doc): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(part)) {
    if (key === "meta" && isPlainObject(value)) {
      for (const sub of Object.keys(value)) out.push(`meta.${sub}`);
    } else {
      out.push(key);
    }
  }
  return out;
}

/** Explicitly listed per-language keys sitting in `_common.yml` (unlisted keys stay page-wide). */
function localeKeysInCommonPaths(common: Doc, opts?: FieldScopeOptions): string[] {
  const { locale } = splitByFieldScope(common, opts);
  const out: string[] = [];
  for (const [key, value] of Object.entries(locale)) {
    if (key === "meta" && isPlainObject(value)) {
      for (const sub of Object.keys(value)) if (LOCALE_META_KEYS.has(sub)) out.push(`meta.${sub}`);
    } else if (LOCALE_TOP_LEVEL_KEYS.has(key)) {
      out.push(key);
    }
  }
  return out;
}

function pruneEmptyMeta(doc: Doc): void {
  if (isPlainObject(doc.meta) && Object.keys(doc.meta).length === 0) delete doc.meta;
}

// ── History ──────────────────────────────────────────────────────────────────

export type SetInfo = { at: number; sha: string; bulk: boolean };

export interface ValueHistory {
  /** When the field last took `current` in this file (content-repo path); null = unknown. */
  lastSet(relPath: string, fieldPath: string, current: unknown): SetInfo | null;
}

/** Value-level history from a local clone of the content repo. */
export function gitValueHistory(repoDir: string, opts: { bulkFiles?: number } = {}): ValueHistory {
  const bulkFiles = opts.bulkFiles ?? BULK_COMMIT_FILES;
  const git = (args: string[]) =>
    execFileSync("git", ["-C", repoDir, ...args], {
      encoding: "utf-8",
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  const logs = new Map<string, Array<{ sha: string; at: number; path: string }>>();
  const docs = new Map<string, Doc | null>();
  const sizes = new Map<string, number>();

  const commitsOf = (rel: string) => {
    let list = logs.get(rel);
    if (list) return list;
    list = [];
    let out = "";
    try {
      out = git(["log", "--follow", "--format=%x01%H%x09%cI", "--name-only", "--", rel]);
    } catch {
      out = "";
    }
    for (const chunk of out.split("\x01")) {
      const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const [sha, date] = lines[0]!.split("\t");
      if (!sha || !date) continue;
      list.push({ sha, at: Date.parse(date), path: lines[1] ?? rel });
    }
    logs.set(rel, list);
    return list;
  };

  const docAt = (sha: string, p: string): Doc | null => {
    const key = `${sha}:${p}`;
    if (docs.has(key)) return docs.get(key)!;
    let doc: Doc | null = null;
    try {
      doc = safeLoadYaml(git(["show", key]));
    } catch {
      doc = null;
    }
    docs.set(key, doc);
    return doc;
  };

  const filesIn = (sha: string): number => {
    const cached = sizes.get(sha);
    if (cached !== undefined) return cached;
    let n = 0;
    try {
      n = git(["diff-tree", "--no-commit-id", "--name-only", "-r", sha]).split("\n").filter(Boolean).length;
    } catch {
      n = 0;
    }
    sizes.set(sha, n);
    return n;
  };

  return {
    lastSet(relPath, fieldPath, current) {
      let found: { sha: string; at: number } | null = null;
      for (const c of commitsOf(relPath)) {
        const value = getAtPath(docAt(c.sha, c.path) ?? {}, fieldPath);
        if (!sameValue(value, current)) break;
        found = c;
      }
      if (!found || Number.isNaN(found.at)) return null;
      return { at: found.at, sha: found.sha, bulk: filesIn(found.sha) > bulkFiles };
    },
  };
}

// ── Resolver ─────────────────────────────────────────────────────────────────

export type Candidate = { source: string; value: unknown; set: () => SetInfo | null };

export type Resolution = {
  /** undefined when no copy holds a real value. */
  value: unknown;
  source: string | null;
  sha?: string;
  flags: Array<"no_history" | "bulk_change">;
};

/**
 * Newest real value wins. All copies equal → that value. Missing or tied history →
 * `fallbackSource` (what visitors see today), flagged `no_history`.
 */
export function pickNewestValue(candidates: Candidate[], fallbackSource: string | null): Resolution {
  const real = candidates.filter((c) => isRealValue(c.value));
  if (real.length === 0) return { value: undefined, source: null, flags: [] };
  if (real.every((c) => sameValue(c.value, real[0]!.value))) {
    return { value: real[0]!.value, source: real[0]!.source, flags: [] };
  }
  const dated = real.map((c) => ({ c, set: c.set() }));
  const fallback = (): Resolution => {
    const pick = real.find((c) => c.source === fallbackSource) ?? real[0]!;
    return { value: pick.value, source: pick.source, flags: ["no_history"] };
  };
  if (dated.some((d) => !d.set)) return fallback();
  const newest = Math.max(...dated.map((d) => d.set!.at));
  const top = dated.filter((d) => d.set!.at === newest);
  if (top.some((d) => !sameValue(d.c.value, top[0]!.c.value))) return fallback();
  const winner = top[0]!;
  return {
    value: winner.c.value,
    source: winner.c.source,
    sha: winner.set!.sha,
    flags: winner.set!.bulk ? ["bulk_change"] : [],
  };
}

// ── Entry plan ───────────────────────────────────────────────────────────────

export type EntryInput = {
  slug: string;
  /** Content-repo path of `_common.yml` (also used when it must be created). */
  commonRel: string;
  common: Doc | null;
  locales: Array<{ locale: string; rel: string; data: Doc }>;
  /** `base` = live locale file when the draft was made (null: compare with today's live). */
  drafts: Array<{ locale: string; variant: string; rel: string; data: Doc; base: Doc | null }>;
  defaultLocale: string;
  scopeOpts?: FieldScopeOptions;
};

export type FieldDecision = {
  field_path: string;
  direction: "to_common" | "to_locales";
  winner: string | null;
  sha?: string;
  flags: string[];
  display_changes: Array<{ locale: string; before: unknown; after: unknown }>;
};

export type EntryPlan = {
  decisions: FieldDecision[];
  drafts_changed: Array<{ rel: string; locale: string; variant: string; removed: string[]; added: string[] }>;
  /** Content-repo path → full new document. */
  writes: Map<string, Doc>;
  created_common: boolean;
};

export function planEntry(input: EntryInput, history: ValueHistory): EntryPlan {
  const opts = input.scopeOpts;
  const plan: EntryPlan = { decisions: [], drafts_changed: [], writes: new Map(), created_common: false };

  // 1. Drafts: drop page-level values that are only a copy of the live locale file.
  const drafts = input.drafts.map((d) => ({ ...d, data: cloneJson(d.data), removed: [] as string[], added: [] as string[] }));
  for (const d of drafts) {
    const base = d.base ?? input.locales.find((l) => l.locale === d.locale)?.data ?? {};
    for (const p of pathsOf(splitByFieldScope(d.data, opts).common)) {
      const v = getAtPath(d.data, p);
      if (v === null) continue;
      if (sameValue(v, getAtPath(base, p))) {
        deleteAtPath(d.data, p);
        d.removed.push(p);
      }
    }
    pruneEmptyMeta(d.data);
  }

  const locales = input.locales.map((l) => ({ ...l, data: cloneJson(l.data), touched: false }));
  let common: Doc | null = input.common ? cloneJson(input.common) : null;
  let commonTouched = false;

  // 2a. Page-level fields in language files → `_common.yml`.
  const pagePaths = new Set<string>();
  for (const l of locales) {
    for (const p of pathsOf(splitByFieldScope(l.data, opts).common)) pagePaths.add(p);
  }
  for (const p of pagePaths) {
    const commonVal = common ? getAtPath(common, p) : undefined;
    const visible = (own: unknown) =>
      isPlainObject(own) && isPlainObject(commonVal) ? deepMerge(commonVal, own) : own;
    const candidates: Candidate[] = [];
    if (common && commonVal !== undefined) {
      const rel = input.commonRel;
      candidates.push({ source: "_common", value: commonVal, set: () => history.lastSet(rel, p, commonVal) });
    }
    const withOwn: string[] = [];
    for (const l of locales) {
      const own = getAtPath(l.data, p);
      if (own === undefined || own === null) continue;
      withOwn.push(l.locale);
      candidates.push({ source: l.locale, value: visible(own), set: () => history.lastSet(l.rel, p, own) });
    }
    const fallback = withOwn.includes(input.defaultLocale) ? input.defaultLocale : ([...withOwn].sort()[0] ?? null);
    const res = pickNewestValue(candidates, fallback);
    const finalVal = res.value === undefined ? commonVal : res.value;

    const display: FieldDecision["display_changes"] = [];
    for (const l of locales) {
      const own = getAtPath(l.data, p);
      const before = own !== undefined && own !== null ? visible(own) : commonVal;
      if (!sameShown(before, finalVal)) display.push({ locale: l.locale, before, after: finalVal });
    }

    if (res.value !== undefined && !sameValue(commonVal, res.value)) {
      if (!common) {
        common = { slug: input.slug };
        plan.created_common = true;
      }
      setAtPath(common, p, cloneJson(res.value));
      commonTouched = true;
    }
    for (const l of locales) {
      if (getAtPath(l.data, p) === undefined) continue;
      deleteAtPath(l.data, p);
      pruneEmptyMeta(l.data);
      l.touched = true;
    }
    plan.decisions.push({
      field_path: p,
      direction: "to_common",
      winner: res.source,
      ...(res.sha ? { sha: res.sha } : {}),
      flags: res.flags,
      display_changes: display,
    });
  }

  // 2b. Per-language fields in `_common.yml` → each language file. Search settings are
  // language-neutral, so the newest copy wins; for text (title, description, content…) the
  // `_common.yml` copy is a one-language fallback, so a language keeps its own copy.
  if (common) {
    const commonDoc = common;
    for (const p of localeKeysInCommonPaths(commonDoc, opts)) {
      const newestWins = p.startsWith("meta.") && LOCALE_META_KEYS.has(p.slice("meta.".length));
      const commonVal = getAtPath(commonDoc, p);
      let commonSet: SetInfo | null | undefined;
      const commonSetOnce = () => {
        if (commonSet === undefined) commonSet = history.lastSet(input.commonRel, p, commonVal);
        return commonSet;
      };
      const flags: string[] = [];
      const display: FieldDecision["display_changes"] = [];
      /** Locales that showed the `_common.yml` value (no own copy) and what they show now. */
      const inherited = new Map<string, unknown>();
      for (const l of locales) {
        const own = getAtPath(l.data, p);
        if (own === undefined) {
          if (isRealValue(commonVal)) {
            setAtPath(l.data, p, cloneJson(commonVal));
            l.touched = true;
            inherited.set(l.locale, commonVal);
          }
          continue;
        }
        if (!newestWins) continue;
        const res = pickNewestValue(
          [
            { source: "_common", value: commonVal, set: commonSetOnce },
            { source: l.locale, value: own, set: () => history.lastSet(l.rel, p, own) },
          ],
          l.locale,
        );
        for (const f of res.flags) flags.push(`${l.locale}:${f}`);
        if (res.value !== undefined && !sameValue(res.value, own)) {
          setAtPath(l.data, p, cloneJson(res.value));
          l.touched = true;
          display.push({ locale: l.locale, before: own, after: res.value });
        }
      }
      // A draft replaces its locale file on publish: keep the value that used to come from `_common.yml`.
      for (const d of drafts) {
        if (getAtPath(d.data, p) !== undefined) continue;
        const live = locales.find((l) => l.locale === d.locale);
        const value = live ? inherited.get(d.locale) : isRealValue(commonVal) ? commonVal : undefined;
        if (value === undefined) continue;
        setAtPath(d.data, p, cloneJson(value));
        d.added.push(p);
      }
      deleteAtPath(commonDoc, p);
      pruneEmptyMeta(commonDoc);
      commonTouched = true;
      plan.decisions.push({
        field_path: p,
        direction: "to_locales",
        winner: newestWins ? "newest per language" : "each language keeps its own copy",
        flags,
        display_changes: display,
      });
    }
  }

  if (common && commonTouched) plan.writes.set(input.commonRel, common);
  for (const l of locales) if (l.touched) plan.writes.set(l.rel, l.data);
  for (const d of drafts) {
    if (!d.removed.length && !d.added.length) continue;
    plan.writes.set(d.rel, d.data);
    plan.drafts_changed.push({ rel: d.rel, locale: d.locale, variant: d.variant, removed: d.removed, added: d.added });
  }
  return plan;
}

// ── Runner ───────────────────────────────────────────────────────────────────

export type FieldScopeMigrationSite = { name: string; contentRoot: string };

export type ProposalSummary = { id: string; title: string; status: string; open_blocker_count: number };

export type FieldScopeMigrationDeps = {
  sites: () => FieldScopeMigrationSite[];
  defaultLocale: (contentRoot: string) => string;
  /** Local files changed by an earlier run of this migration and not pushed yet. */
  pendingFromMigration: (site: string) => string[];
  markModified: (absPath: string, contentRoot: string) => void;
  push: (site: string, files: string[], message: string) => Promise<{ success: boolean; commitHash?: string; error?: string }>;
  openHistory: () => { history: ValueHistory; cleanup: () => void };
  recordDraftRewrite: (site: string, proposalId: string, absPath: string) => void;
  proposalSummary: (site: string, proposalId: string) => ProposalSummary | null;
};

/** Full-history clone of the content repo (about 40 MB) with the sync token. */
export function cloneContentRepo(opts: { owner: string; repo: string; branch: string; token: string }): { dir: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "migration-006-"));
  const auth = Buffer.from(`x-access-token:${opts.token}`).toString("base64");
  try {
    execFileSync(
      "git",
      [
        "-c",
        `http.extraHeader=AUTHORIZATION: basic ${auth}`,
        "clone",
        "--quiet",
        "--single-branch",
        "--branch",
        opts.branch,
        `https://github.com/${opts.owner}/${opts.repo}.git`,
        dir,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    const msg = err instanceof Error ? err.message.replace(auth, "***") : String(err);
    throw new Error(`Could not clone ${opts.owner}/${opts.repo}: ${msg.split("\n")[0]}`);
  }
  return { dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

async function defaultDeps(): Promise<FieldScopeMigrationDeps> {
  const { getSiteContextMap } = await import("./site-manager");
  const { detectPendingChanges, markFileAsModified, flushPendingSyncStateWrites } = await import("./sync-state");
  const { commitAndPush, getGitHubConfig } = await import("./github");
  const { getDefaultLocale } = await import("./settings");
  const { recordSystemDraftRewrite, proposalBlockerSummary } = await import("./content-proposals/service");
  return {
    sites: () =>
      Array.from(getSiteContextMap().values()).map((c) => ({ name: c.contentRootName, contentRoot: c.contentRoot })),
    defaultLocale: (contentRoot) => {
      try {
        return getDefaultLocale(contentRoot) || "en";
      } catch {
        return "en";
      }
    },
    pendingFromMigration: (site) =>
      detectPendingChanges(site)
        .filter((c) => c.source === "local" && c.author === MIGRATION_AUTHOR)
        .map((c) => c.file),
    markModified: (absPath, contentRoot) => {
      markFileAsModified(absPath, MIGRATION_AUTHOR, undefined, contentRoot);
      flushPendingSyncStateWrites(contentRoot);
    },
    push: (site, files, message) => commitAndPush(message, { files, contentRoot: site, onlyBlockOnOverlap: true }),
    openHistory: () => {
      const config = getGitHubConfig();
      if (!config) throw new Error("GitHub not configured (GITHUB_TOKEN / GITHUB_REPO_URL): history is needed to pick the newest value.");
      const clone = cloneContentRepo(config);
      return { history: gitValueHistory(clone.dir), cleanup: clone.cleanup };
    },
    recordDraftRewrite: (site, proposalId, absPath) => {
      recordSystemDraftRewrite(site, proposalId, absPath);
    },
    proposalSummary: (site, proposalId) => proposalBlockerSummary(site, proposalId),
  };
}

function loadDoc(filePath: string): Doc | null {
  try {
    const parsed = safeLoadYaml(fs.readFileSync(filePath, "utf-8"));
    return parsed && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Gather one entry's files (content-repo paths keep the `site_*` prefix). */
function entryInput(
  entry: ScannedEntry,
  site: FieldScopeMigrationSite,
  absRoot: string,
  defaultLocale: string,
): { input: EntryInput; refs: Map<string, { ref: DraftRef; abs: string }>; abs: Map<string, string> } | { unreadable: string } {
  const rel = (abs: string) => `${site.name}/${path.relative(absRoot, abs).split(path.sep).join("/")}`;
  const abs = new Map<string, string>();
  const commonAbs = entry.commonPath ?? path.join(entry.dir, "_common.yml");
  const commonRel = rel(commonAbs);
  abs.set(commonRel, commonAbs);
  const common = entry.commonPath ? loadDoc(entry.commonPath) : null;
  if (entry.commonPath && !common) return { unreadable: commonRel };
  const locales: EntryInput["locales"] = [];
  for (const l of entry.live) {
    const data = loadDoc(l.filePath);
    if (!data) return { unreadable: rel(l.filePath) };
    abs.set(rel(l.filePath), l.filePath);
    locales.push({ locale: l.locale, rel: rel(l.filePath), data });
  }
  const refs = new Map<string, { ref: DraftRef; abs: string }>();
  const drafts: EntryInput["drafts"] = [];
  for (const v of entry.variants) {
    const data = readVariantData(v.filePath);
    if (!data) return { unreadable: rel(v.filePath) };
    const ref: DraftRef = {
      contentType: entry.contentType,
      slug: entry.slug,
      locale: v.locale,
      variant: v.variant,
      contentRoot: site.contentRoot,
    };
    const r = rel(v.filePath);
    abs.set(r, v.filePath);
    refs.set(r, { ref, abs: v.filePath });
    drafts.push({ locale: v.locale, variant: v.variant, rel: r, data, base: baseSnapshotOf(ref)?.live ?? null });
  }
  return {
    input: {
      slug: entry.slug,
      commonRel,
      common,
      locales,
      drafts,
      defaultLocale,
      scopeOpts: scopeOptionsOf({ contentType: entry.contentType, contentRoot: site.contentRoot }),
    },
    refs,
    abs,
  };
}

export async function runFieldScopeMigration(opts: {
  site?: string;
  dryRun: boolean;
  log?: Log;
  error?: Log;
  deps?: FieldScopeMigrationDeps;
}): Promise<{ failed: boolean }> {
  const log = opts.log ?? console.log;
  const error = opts.error ?? console.error;
  const deps = opts.deps ?? (await defaultDeps());
  let failed = false;
  let matched = false;
  let opened: { history: ValueHistory; cleanup: () => void } | null = null;
  /** The clone is made only when two copies actually disagree. */
  const lazyHistory: ValueHistory = {
    lastSet: (relPath, fieldPath, current) => {
      if (!opened) opened = deps.openHistory();
      return opened.history.lastSet(relPath, fieldPath, current);
    },
  };

  try {
    for (const s of deps.sites()) {
      if (opts.site && s.name !== opts.site) continue;
      matched = true;
      log("site", s.name);
      const absRoot = path.isAbsolute(s.contentRoot) ? s.contentRoot : path.join(process.cwd(), s.contentRoot);

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
        if (!opts.dryRun && !(await push(leftover, "Field scope cleanup (push files left by an interrupted run)"))) {
          failed = true;
          continue;
        }
      }

      const defaultLocale = deps.defaultLocale(s.contentRoot);
      const changed = new Set<string>();
      const recheck = new Map<string, ProposalSummary>();
      let fields = 0;
      let displayChanges = 0;
      let flagged = 0;
      let draftsCleaned = 0;

      for (const entry of scanEntries(absRoot)) {
        const name = `${entry.contentType}/${entry.slug}`;
        const gathered = entryInput(entry, s, absRoot, defaultLocale);
        if ("unreadable" in gathered) {
          error("unreadable_yaml", gathered.unreadable, "left untouched");
          continue;
        }
        const plan = planEntry(gathered.input, lazyHistory);
        if (plan.writes.size === 0) continue;

        for (const d of plan.decisions) {
          fields++;
          displayChanges += d.display_changes.length;
          if (d.flags.length) flagged++;
          log(opts.dryRun ? "would_move" : "move", name, d.field_path, d.direction === "to_common" ? "→ _common.yml" : "→ each language", {
            winner: d.winner,
            ...(d.sha ? { commit: d.sha.slice(0, 7) } : {}),
            ...(d.flags.length ? { flags: d.flags } : {}),
            ...(d.display_changes.length ? { display_changes: d.display_changes } : {}),
          });
        }
        if (plan.created_common) log(opts.dryRun ? "would_create" : "create", gathered.input.commonRel);
        for (const d of plan.drafts_changed) {
          draftsCleaned++;
          log(opts.dryRun ? "would_clean_draft" : "clean_draft", d.rel, {
            ...(d.removed.length ? { removed_copies: d.removed } : {}),
            ...(d.added.length ? { kept_from_common: d.added } : {}),
          });
          const link = readDraftMeta(gathered.refs.get(d.rel)!.abs)?.proposal;
          if (link?.id && !recheck.has(link.id)) {
            const summary = deps.proposalSummary(s.name, link.id);
            if (summary && summary.open_blocker_count > 0 && (summary.status === "open" || summary.status === "partial")) {
              recheck.set(link.id, summary);
            }
          }
        }

        if (opts.dryRun) {
          for (const r of plan.writes.keys()) changed.add(r);
          continue;
        }

        // Base / translation source still matching live before this cleanup → re-stamp after it.
        const restamp: Array<{ ref: DraftRef; abs: string; rel: string; base: boolean; source: string | null }> = [];
        for (const [r, { ref, abs }] of gathered.refs) {
          const base = checkDraftBase(ref).status === "ok";
          const src = checkTranslationSource(ref);
          restamp.push({ ref, abs, rel: r, base, source: src.status === "ok" ? src.source_locale : null });
        }

        for (const [r, doc] of plan.writes) {
          const abs = gathered.abs.get(r)!;
          if (gathered.refs.has(r)) {
            writeVariantFile(abs, safeDumpYaml(doc), { skipMark: true });
          } else {
            fs.writeFileSync(abs, safeDumpYaml(doc), "utf-8");
          }
          deps.markModified(abs, s.contentRoot);
          changed.add(r);
        }
        for (const d of restamp) {
          if (d.base) recordDraftBase(d.ref, { author: MIGRATION_AUTHOR, skipMark: true });
          if (d.source) recordTranslationSource(d.ref, d.source, { author: MIGRATION_AUTHOR, skipMark: true });
          if (d.base || d.source) {
            deps.markModified(d.abs, s.contentRoot);
            changed.add(d.rel);
          }
        }
        for (const d of plan.drafts_changed) {
          const abs = gathered.refs.get(d.rel)!.abs;
          const link = readDraftMeta(abs)?.proposal;
          if (link?.id) deps.recordDraftRewrite(s.name, link.id, abs);
        }
      }

      for (const p of recheck.values()) {
        log("recheck_proposal", p.id, `"${p.title}"`, `${p.open_blocker_count} open needs-changes`, "re-preview (dry run works while blocked), then resolve");
      }
      log("summary", {
        files_changed: changed.size,
        fields_moved: fields,
        languages_whose_display_changes: displayChanges,
        fields_flagged: flagged,
        drafts_cleaned: draftsCleaned,
        proposals_to_recheck: recheck.size,
      });
      if (changed.size === 0) {
        log("nothing_to_push", "every field already lives in the right file");
        continue;
      }
      if (opts.dryRun) continue;
      if (!(await push([...changed], `Field scope cleanup: keep each field once, in the right file (${changed.size} file(s))`))) {
        failed = true;
      }
    }
  } catch (err) {
    error("migration_failed", err instanceof Error ? err.message : String(err));
    failed = true;
  } finally {
    (opened as { cleanup: () => void } | null)?.cleanup();
  }

  if (opts.site && !matched) {
    error("site_not_found", opts.site);
    failed = true;
  }
  return { failed };
}
