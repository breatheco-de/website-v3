/**
 * Fixers for draft-integrity issues:
 * - orphan-entry-versioning: delete versioning.yml that lists no existing variant file
 * - draft-meta-in-published: strip `_draft` from `_common.yml` / live locale files
 * - field-scope-mismatch: move per-language keys (incl. `meta.robots`) out of `_common.yml` into
 *   every language file (and draft) that lacks them; move page-wide keys from language files
 *   to `_common.yml` only when every published language has the same value.
 *   What each language renders never changes (merge order: _common, then locale).
 */

import fs from "fs";
import type { Fixer, FixerContext, FixerResult } from "./types";
import { resolveScanRoot, scanEntries, type ScannedEntry } from "../shared/draft-scan";
import {
  commonKeysInLocale,
  isOrphanVersioning,
  localeKeysInCommon,
} from "../validators/draft-integrity";
import { DRAFT_META_KEY, safeDumpYaml, safeLoadYaml, stripDraftMetaFromRaw } from "../../../server/versioning/draft-meta";
import { sameValue } from "../../../server/versioning/draft-base";
import { deleteAtPath, getAtPath, setAtPath } from "@shared/object-path";

type Doc = Record<string, unknown>;

function load(filePath: string): Doc | null {
  try {
    const parsed = safeLoadYaml(fs.readFileSync(filePath, "utf-8"));
    return parsed && !Array.isArray(parsed) ? (parsed as Doc) : null;
  } catch {
    return null;
  }
}

function contentRootOf(ctx: FixerContext): string {
  return resolveScanRoot(typeof ctx.contentRoot === "string" ? ctx.contentRoot : undefined);
}

function hasPath(doc: Doc, p: string): boolean {
  return getAtPath(doc, p) !== undefined;
}

function pruneEmptyMeta(doc: Doc): void {
  const meta = doc.meta;
  if (meta && typeof meta === "object" && !Array.isArray(meta) && Object.keys(meta).length === 0) delete doc.meta;
}

export const orphanEntryVersioningFixer: Fixer = {
  name: "orphan-entry-versioning",
  description: "Delete entry versioning.yml files that list no existing variant file",
  async run(ctx) {
    const dryRun = ctx.dryRun !== false;
    const removed: string[] = [];
    for (const entry of scanEntries(contentRootOf(ctx))) {
      if (!isOrphanVersioning(entry)) continue;
      removed.push(entry.versioningPath!);
      if (!dryRun) fs.unlinkSync(entry.versioningPath!);
      ctx.onProgress?.({ type: "item", id: entry.versioningPath!, status: "ok", message: "orphan versioning.yml" });
    }
    return {
      ok: true,
      message: `${dryRun ? "Would delete" : "Deleted"} ${removed.length} orphan versioning.yml file(s)`,
      details: { dryRun, files: removed },
    };
  },
};

export const draftMetaInPublishedFixer: Fixer = {
  name: "draft-meta-in-published",
  description: "Strip the internal _draft block from _common.yml and published locale files",
  async run(ctx) {
    const dryRun = ctx.dryRun !== false;
    const fixed: string[] = [];
    for (const entry of scanEntries(contentRootOf(ctx))) {
      const files = [...(entry.commonPath ? [entry.commonPath] : []), ...entry.live.map((l) => l.filePath)];
      for (const filePath of files) {
        const raw = fs.readFileSync(filePath, "utf-8");
        const data = load(filePath);
        if (!data || !(DRAFT_META_KEY in data)) continue;
        fixed.push(filePath);
        if (!dryRun) fs.writeFileSync(filePath, stripDraftMetaFromRaw(raw), "utf-8");
      }
    }
    return {
      ok: true,
      message: `${dryRun ? "Would strip" : "Stripped"} _draft from ${fixed.length} published file(s)`,
      details: { dryRun, files: fixed },
    };
  },
};

export type FieldScopeFixPlan = {
  entry: string;
  moved_to_locales: string[];
  moved_to_common: string[];
  needs_review: Array<{ field: string; reason: string }>;
  writes: Map<string, Doc>;
};

/** Pure plan for one entry (exported for tests). */
export function planFieldScopeFix(entry: ScannedEntry): FieldScopeFixPlan {
  const plan: FieldScopeFixPlan = {
    entry: `${entry.contentType}/${entry.slug}`,
    moved_to_locales: [],
    moved_to_common: [],
    needs_review: [],
    writes: new Map(),
  };
  const docs = new Map<string, Doc>();
  const doc = (filePath: string): Doc | null => {
    if (!docs.has(filePath)) {
      const d = load(filePath);
      if (!d) return null;
      docs.set(filePath, d);
    }
    return docs.get(filePath)!;
  };
  const common = entry.commonPath ? doc(entry.commonPath) : null;
  const liveDocs = entry.live.map((l) => ({ ...l, data: doc(l.filePath) })).filter((l) => l.data);

  if (common && entry.commonPath) {
    for (const key of localeKeysInCommon(common)) {
      if (!liveDocs.length) {
        plan.needs_review.push({ field: key, reason: "no published language file to move it into" });
        continue;
      }
      const value = getAtPath(common, key);
      const targets = [...liveDocs.map((l) => l.filePath), ...entry.variants.map((v) => v.filePath)];
      for (const t of targets) {
        const d = doc(t);
        if (!d || hasPath(d, key)) continue;
        setAtPath(d, key, structuredClone(value));
        plan.writes.set(t, d);
      }
      deleteAtPath(common, key);
      pruneEmptyMeta(common);
      plan.writes.set(entry.commonPath, common);
      plan.moved_to_locales.push(key);
    }
  }

  const candidates = new Set<string>();
  for (const l of liveDocs) for (const k of commonKeysInLocale(l.data)) candidates.add(k);
  for (const key of Array.from(candidates)) {
    const values = liveDocs.map((l) => getAtPath(l.data!, key));
    if (values.some((v) => v === undefined)) {
      plan.needs_review.push({ field: key, reason: "not set in every published language" });
      continue;
    }
    if (!values.every((v) => sameValue(v, values[0]))) {
      plan.needs_review.push({ field: key, reason: "languages have different values" });
      continue;
    }
    if (!entry.commonPath) {
      plan.needs_review.push({ field: key, reason: "entry has no _common.yml" });
      continue;
    }
    const c = common ?? {};
    const existing = getAtPath(c, key);
    if (existing !== undefined && !sameValue(existing, values[0])) {
      plan.needs_review.push({ field: key, reason: "_common.yml has a different value (hidden by every language)" });
      continue;
    }
    setAtPath(c, key, structuredClone(values[0]));
    plan.writes.set(entry.commonPath, c);
    for (const l of liveDocs) {
      deleteAtPath(l.data!, key);
      pruneEmptyMeta(l.data!);
      plan.writes.set(l.filePath, l.data!);
    }
    plan.moved_to_common.push(key);
  }
  return plan;
}

export const fieldScopeMismatchFixer: Fixer = {
  name: "field-scope-mismatch",
  description:
    "Move per-language fields out of _common.yml and page-wide fields into _common.yml when every language agrees (display unchanged)",
  async run(ctx): Promise<FixerResult> {
    const dryRun = ctx.dryRun !== false;
    const only = typeof ctx.contentType === "string" ? ctx.contentType : undefined;
    const summary: Array<Omit<FieldScopeFixPlan, "writes"> & { files: string[] }> = [];
    let files = 0;
    for (const entry of scanEntries(contentRootOf(ctx))) {
      if (only && entry.contentType !== only) continue;
      const plan = planFieldScopeFix(entry);
      if (!plan.writes.size && !plan.needs_review.length) continue;
      const { writes, ...rest } = plan;
      summary.push({ ...rest, files: Array.from(writes.keys()) });
      files += writes.size;
      if (dryRun) continue;
      for (const [filePath, data] of Array.from(writes.entries())) fs.writeFileSync(filePath, safeDumpYaml(data), "utf-8");
    }
    const review = summary.reduce((n, s) => n + s.needs_review.length, 0);
    return {
      ok: true,
      message: `${dryRun ? "Would update" : "Updated"} ${files} file(s) across ${summary.length} entr(ies); ${review} field(s) need a person to choose`,
      details: { dryRun, entries: summary },
    };
  },
};
