/**
 * Draft files behind v1.0 proposals.
 *
 * A v1.0 `edits` proposal never writes live content: `proposals_create` and
 * `revise_entries` write their updates into a draft (`{variant}.{locale}.yml`),
 * and apply only promotes that draft. This module is the file side of that
 * contract; the proposal service stays testable by swapping it out.
 */

import fs from "fs";
import path from "path";
import { fieldScope, splitByFieldScope } from "@shared/field-scope";
import { getAtPath } from "@shared/object-path";
import { LIVE_SHELL_BASENAME_RE } from "@shared/sharedLayoutPaths";
import type { SiteContext } from "../site-manager";
import { applyFieldUpdates } from "../field-write-router";
import { urlParamsForContentType } from "../field-scope-config";
import {
  attachedOverlayStructureError,
  isEntryDetached,
  isSharedLayoutType,
  isTemplateVersioningSlug,
  listAttachedEntries,
  resolveWritableVersioningTarget,
} from "../shared-layout-entry";
import { countVariantFiles, hasAnyLiveLocale } from "../draft-entry";
import { deleteContentEntry } from "../content-editor";
import { getAllConfigs, getFolder } from "../content-types";
import { markFileAsModified } from "../sync-state";
import { pruneVersioningAfterVariantRemove } from "../versioning/delete-variant.js";
import { readVariantAllocation } from "../versioning/variant-traffic";
import {
  hashVariantFileContents,
  readDraftMeta,
  readVariantData,
  relFromCwd,
  safeDumpYaml,
  writeDraftMeta,
  writeVariantFile,
  type DraftProposalLink,
} from "../versioning/draft-meta";
import {
  authorDiff,
  checkDraftBase,
  checkTranslationSource,
  commonPathOf,
  draftPathOf,
  draftSeedFromLive,
  forgetDraftBase,
  funnelCarriedWarning,
  livePathOf,
  rebuildDraftFromBase,
  recordDraftBase,
  recordTranslationSource,
  scopeOptionsOf,
  type AuthorDiff,
  type DraftBaseCheck,
  type DraftRef,
  type RebuildResult,
  type TranslationSourceCheck,
} from "../versioning/draft-base";

/** Bump when the draft diff logic changes so cached proposal views are rebuilt. */
const DERIVED_VIEW_VERSION = "v2";

export type ProposalDraftRef = {
  contentType: string;
  slug: string;
  locale: string;
  variant: string;
};

export type DraftFieldUpdate = { field_path: string; value?: unknown; reset?: boolean; op?: "set" | "remove" };

export type DraftWriteResult =
  | { ok: true; warnings: Array<{ code: string; message: string }> }
  | { ok: false; code?: string; error: string; details?: unknown };

export type ProposalDraftStore = {
  /** Entry folder has any file (live locale, `_common.yml` or a draft). */
  entryExists(contentType: string, slug: string): boolean;
  exists(ref: ProposalDraftRef): boolean;
  /** The published locale file exists. */
  liveExists(entry: { contentType: string; slug: string; locale: string }): boolean;
  /** Absolute path of the draft file. */
  pathOf(ref: ProposalDraftRef): string;
  /** `draft` when free; otherwise `draft-p{id6}` (+ numeric suffix). Never reuses an existing file. */
  pickVariant(
    entry: { contentType: string; slug: string; locale: string },
    proposalId: string,
    opts?: { ownName?: boolean },
  ): string;
  /**
   * Create the draft: a copy of the live locale (without `_draft`), or `{}` when the
   * locale is not published. Registers it at 0% and records its base.
   * `newEntry` also creates the entry folder with `_common.yml` (accepted idea).
   * `seo` seeds the `seo:` block only when the locale is not published yet (idea target).
   */
  create(
    ref: ProposalDraftRef,
    opts: {
      author: string;
      newEntry?: { funnel?: Record<string, unknown> | null };
      seo?: Record<string, unknown> | null;
    },
  ): { ok: true; warnings?: Array<{ code: string; message: string }> } | { ok: false; code: string; error: string };
  /** Allocation in versioning.yml; null when not registered (a draft). */
  allocation(ref: ProposalDraftRef): number | null;
  /** Post that uses the shared template (drafts may only change fields). */
  isAttached(contentType: string, slug: string): boolean;
  structureError(ref: ProposalDraftRef): string | null;
  /** Replace the draft body with today's live (`{}` when unpublished), keep `_draft`, and record a new base. */
  reset(ref: ProposalDraftRef, author: string): Array<{ code: string; message: string }> | void;
  snapshotRaw(ref: ProposalDraftRef): string | null;
  restoreRaw(ref: ProposalDraftRef, raw: string, author: string): void;
  write(ref: ProposalDraftRef, updates: DraftFieldUpdate[], author: string): Promise<DraftWriteResult>;
  /** Content hash of the draft (`_draft` ignored); null when missing. */
  fingerprint(ref: ProposalDraftRef): string | null;
  /** Draft stages page-level (`common`) fields, including `null` removals. */
  carriesCommon(ref: ProposalDraftRef): boolean;
  readLink(ref: ProposalDraftRef): DraftProposalLink | null;
  link(ref: ProposalDraftRef, link: DraftProposalLink | null, author: string): void;
  /** Delete the draft, its versioning row (and versioning.yml when empty). Removes the entry when nothing else is left. */
  remove(ref: ProposalDraftRef, author: string): Promise<{ entryDeleted: boolean }>;
  authorDiff(ref: ProposalDraftRef): AuthorDiff | null;
  /** Cache key for the derived ops view: draft content + base + today's live/source hashes. */
  derivedKey(ref: ProposalDraftRef): string | null;
  checkBase(ref: ProposalDraftRef): DraftBaseCheck;
  rebuild(ref: ProposalDraftRef, opts: { preview: boolean; author?: string }): RebuildResult;
  checkSource(ref: ProposalDraftRef, withFields?: boolean): TranslationSourceCheck;
  recordBase(ref: ProposalDraftRef, author: string): void;
  recordSource(ref: ProposalDraftRef, sourceLocale: string, author: string): void;
  /** Published value of a field: `_common.yml` for page-level fields, else the locale file. */
  liveValue(entry: { contentType: string; slug: string; locale: string }, fieldPath: string): unknown;
  /** Every entry-folder draft carrying `_draft.proposal` (daily link check). */
  listLinkedDrafts(): Array<{ ref: ProposalDraftRef; link: DraftProposalLink }>;
  /** Attached entries published in `locale` (what a template proposal reaches). */
  listAttachedEntries?(contentType: string, locale: string): string[];
  /** Locales with a live shared template (`template.{locale}.yml`) for this type. */
  listTemplateLocales?(contentType: string): string[];
  /** Value of a field in the draft file; undefined when the draft or field is missing. */
  draftValue?(ref: ProposalDraftRef, fieldPath: string): unknown;
};

const VARIANT_FILE_RE = /^([a-z0-9][a-z0-9_-]*)\.([a-z]{2}(?:-[a-z]{2})?)\.ya?ml$/i;

function hashFileOrNull(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  return hashVariantFileContents(fs.readFileSync(filePath, "utf-8"));
}

export function draftStoreForSite(ctx: SiteContext): ProposalDraftStore {
  const contentRoot = ctx.contentRoot;
  const withRoot = (ref: ProposalDraftRef): DraftRef => ({ ...ref, contentRoot });
  const entryDir = (contentType: string, slug: string): string =>
    path.join(
      path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot),
      getFolder(contentType, contentRoot),
      slug,
    );

  function registerVariant(ref: ProposalDraftRef, versioningSlug: string, author?: string | null): void {
    const vm = ctx.versioningManager;
    const existing = vm.getVersioningForContent(ref.contentType, versioningSlug) || {};
    const localeData = existing[ref.locale]
      ? { ...existing[ref.locale], variants: [...(existing[ref.locale].variants || [])] }
      : { variants: [] as Array<{ slug: string; allocation: number }> };
    if (!localeData.variants.some((v: { slug: string }) => v.slug === ref.variant)) {
      localeData.variants.push({ slug: ref.variant, allocation: 0 });
    }
    vm.updateVersioning(ref.contentType, versioningSlug, { ...existing, [ref.locale]: localeData }, {
      author,
      contentRoot,
    });
  }

  function seedFromLive(
    ref: ProposalDraftRef,
    livePath: string,
  ): { content: string; warnings: Array<{ code: string; message: string }> } {
    const commonPath = commonPathOf(withRoot(ref));
    const seeded = draftSeedFromLive(fs.readFileSync(livePath, "utf-8"), {
      ...scopeOptionsOf(withRoot(ref)),
      commonRaw: fs.existsSync(commonPath) ? fs.readFileSync(commonPath, "utf-8") : null,
    });
    if (!seeded.carried.includes("funnel")) return { content: seeded.content, warnings: [] };
    const warning = funnelCarriedWarning(ref.locale);
    return {
      content: seeded.content,
      warnings: [{ ...warning, message: `${ref.contentType}/${ref.slug} (${ref.locale}): ${warning.message}` }],
    };
  }

  const store: ProposalDraftStore = {
    listAttachedEntries(contentType, locale) {
      return listAttachedEntries(contentType, locale, contentRoot);
    },
    listTemplateLocales(contentType) {
      const root = path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
      let typeDir: string;
      try {
        typeDir = path.join(root, getFolder(contentType, contentRoot));
      } catch {
        return [];
      }
      if (!fs.existsSync(typeDir)) return [];
      const locales = new Set<string>();
      for (const name of fs.readdirSync(typeDir)) {
        const m = LIVE_SHELL_BASENAME_RE.exec(name);
        if (m?.[1]) locales.add(m[1]);
      }
      return [...locales].sort();
    },
    draftValue(ref, fieldPath) {
      const data = readVariantData(draftPathOf(withRoot(ref)));
      return data ? getAtPath(data, fieldPath) : undefined;
    },
    listLinkedDrafts() {
      const out: Array<{ ref: ProposalDraftRef; link: DraftProposalLink }> = [];
      const root = path.isAbsolute(contentRoot) ? contentRoot : path.join(process.cwd(), contentRoot);
      const seen = new Set<string>();
      for (const contentType of Object.keys(getAllConfigs(contentRoot))) {
        let typeDir: string;
        try {
          typeDir = path.join(root, getFolder(contentType, contentRoot));
        } catch {
          continue;
        }
        if (seen.has(typeDir) || !fs.existsSync(typeDir)) continue;
        seen.add(typeDir);
        for (const d of fs.readdirSync(typeDir, { withFileTypes: true })) {
          if (!d.isDirectory() || d.name.startsWith(".") || d.name.startsWith("_")) continue;
          for (const name of fs.readdirSync(path.join(typeDir, d.name))) {
            const m = VARIANT_FILE_RE.exec(name);
            if (!m || isTemplateVersioningSlug(m[1]!)) continue;
            const link = readDraftMeta(path.join(typeDir, d.name, name))?.proposal;
            if (link?.id) out.push({ ref: { contentType, slug: d.name, locale: m[2]!, variant: m[1]! }, link });
          }
        }
      }
      return out;
    },

    liveValue(entry, fieldPath) {
      const filePath =
        fieldScope(fieldPath, { urlParams: urlParamsForContentType(entry.contentType, contentRoot) }) === "common"
          ? commonPathOf({ ...entry, contentRoot })
          : livePathOf({ ...entry, contentRoot });
      if (!fs.existsSync(filePath)) return undefined;
      return getAtPath(readVariantData(filePath) ?? {}, fieldPath);
    },

    liveExists(entry) {
      return fs.existsSync(livePathOf({ ...entry, contentRoot }));
    },

    entryExists(contentType, slug) {
      if (isTemplateVersioningSlug(slug)) return true;
      const dir = entryDir(contentType, slug);
      if (!fs.existsSync(dir)) return false;
      try {
        return fs.readdirSync(dir).some((f) => /\.ya?ml$/.test(f));
      } catch {
        return false;
      }
    },

    exists(ref) {
      return fs.existsSync(draftPathOf(withRoot(ref)));
    },

    pathOf(ref) {
      return path.resolve(draftPathOf(withRoot(ref)));
    },

    pickVariant(entry, proposalId, opts) {
      const free = (variant: string) =>
        !fs.existsSync(draftPathOf(withRoot({ ...entry, variant }))) &&
        readVariantAllocation({ ...entry, variant, contentRoot }) === null;
      if (!opts?.ownName && free("draft")) return "draft";
      const stem = `draft-p${proposalId.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase()}`;
      if (free(stem)) return stem;
      for (let n = 2; n < 100; n++) {
        if (free(`${stem}-${n}`)) return `${stem}-${n}`;
      }
      return `${stem}-${Date.now().toString(36)}`;
    },

    create(ref, opts) {
      const resolved = resolveWritableVersioningTarget(ref.contentType, ref.slug, contentRoot);
      const draftPath = draftPathOf(withRoot(ref));
      if (fs.existsSync(draftPath)) {
        return { ok: false, code: "variant_exists", error: `Draft ${relFromCwd(draftPath)} already exists.` };
      }
      if (!store.entryExists(ref.contentType, ref.slug)) {
        if (!opts.newEntry) {
          return {
            ok: false,
            code: "entry_not_found",
            error: `Page ${ref.contentType}/${ref.slug} does not exist.`,
          };
        }
        const dir = entryDir(ref.contentType, ref.slug);
        fs.mkdirSync(dir, { recursive: true });
        const commonPath = path.join(dir, "_common.yml");
        if (!fs.existsSync(commonPath)) {
          const common: Record<string, unknown> = { slug: ref.slug };
          if (opts.newEntry.funnel) common.funnel = opts.newEntry.funnel;
          fs.writeFileSync(commonPath, safeDumpYaml(common), "utf-8");
          markFileAsModified(relFromCwd(commonPath), opts.author, undefined, contentRoot);
        }
      } else if (!resolved.ok) {
        return { ok: false, code: "entry_not_found", error: resolved.error };
      }
      const livePath = livePathOf(withRoot(ref));
      const seeded = fs.existsSync(livePath) ? seedFromLive(ref, livePath) : null;
      const content = seeded
        ? seeded.content
        : opts.seo && Object.keys(opts.seo).length > 0
          ? safeDumpYaml({ seo: opts.seo })
          : "{}\n";
      writeVariantFile(draftPath, content, {
        author: opts.author,
        contentRoot,
        relPath: relFromCwd(draftPath),
        meta: null,
      });
      const versioningSlug = resolved.ok ? resolved.slug : ref.slug;
      registerVariant(ref, versioningSlug, opts.author);
      recordDraftBase(withRoot(ref), { author: opts.author });
      if (opts.newEntry) ctx.contentIndex.refresh();
      return { ok: true, warnings: seeded?.warnings ?? [] };
    },

    allocation(ref) {
      return readVariantAllocation({ ...ref, contentRoot });
    },

    isAttached(contentType, slug) {
      return (
        !isTemplateVersioningSlug(slug) &&
        isSharedLayoutType(contentType, contentRoot) &&
        !isEntryDetached(contentType, slug, contentRoot)
      );
    },

    structureError(ref) {
      if (!store.isAttached(ref.contentType, ref.slug)) return null;
      const data = readVariantData(draftPathOf(withRoot(ref)));
      if (!data) return null;
      return attachedOverlayStructureError(data);
    },

    reset(ref, author) {
      const draftPath = draftPathOf(withRoot(ref));
      const livePath = livePathOf(withRoot(ref));
      const seeded = fs.existsSync(livePath) ? seedFromLive(ref, livePath) : null;
      writeVariantFile(draftPath, seeded?.content ?? "{}\n", { author, contentRoot, relPath: relFromCwd(draftPath) });
      recordDraftBase(withRoot(ref), { author });
      return seeded?.warnings ?? [];
    },

    snapshotRaw(ref) {
      const p = draftPathOf(withRoot(ref));
      return fs.existsSync(p) ? fs.readFileSync(p, "utf-8") : null;
    },

    restoreRaw(ref, raw, author) {
      const p = draftPathOf(withRoot(ref));
      fs.writeFileSync(p, raw, "utf-8");
      markFileAsModified(relFromCwd(p), author, undefined, contentRoot);
    },

    async write(ref, updates, author) {
      if (!updates.length) return { ok: true, warnings: [] };
      const result = await applyFieldUpdates({
        contentType: ref.contentType,
        slug: ref.slug,
        locale: ref.locale,
        variant: ref.variant,
        updates: updates.map((u) => ({
          field_path: u.field_path,
          value: u.value,
          reset: u.reset === true,
          ...(u.op ? { op: u.op } : {}),
        })),
        author,
        contentRoot,
        contentRootName: ctx.contentRootName,
        ci: ctx.contentIndex,
        skipSharedLayoutFanOut: true,
        mode: "draft_only",
      });
      if (!result.ok) {
        return { ok: false, code: result.code, error: result.error || "Draft write failed", details: result.details };
      }
      return { ok: true, warnings: result.warnings };
    },

    fingerprint(ref) {
      return hashFileOrNull(draftPathOf(withRoot(ref)));
    },

    carriesCommon(ref) {
      const data = readVariantData(draftPathOf(withRoot(ref)));
      if (!data) return false;
      const { common } = splitByFieldScope(data, {
        urlParams: urlParamsForContentType(ref.contentType, contentRoot),
      });
      return Object.keys(common).length > 0;
    },

    readLink(ref) {
      return readDraftMeta(draftPathOf(withRoot(ref)))?.proposal ?? null;
    },

    link(ref, link, author) {
      const p = draftPathOf(withRoot(ref));
      if (!fs.existsSync(p)) return;
      writeDraftMeta(p, { proposal: link }, { author, contentRoot, relPath: relFromCwd(p) });
    },

    async remove(ref, author) {
      const resolved = resolveWritableVersioningTarget(ref.contentType, ref.slug, contentRoot);
      const versioningSlug = resolved.ok ? resolved.slug : ref.slug;
      const templateMode = resolved.ok ? resolved.templateMode : isTemplateVersioningSlug(ref.slug);
      const draftPath = draftPathOf(withRoot(ref));
      if (fs.existsSync(draftPath)) {
        fs.unlinkSync(draftPath);
        markFileAsModified(relFromCwd(draftPath), author, undefined, contentRoot);
      }
      forgetDraftBase(withRoot(ref));
      const vm = ctx.versioningManager;
      const existing = vm.getVersioningForContent(ref.contentType, versioningSlug);
      if (existing) {
        const { data, isEmpty } = pruneVersioningAfterVariantRemove(existing, ref.locale, ref.variant);
        if (isEmpty) vm.deleteVersioningConfig(ref.contentType, versioningSlug, author, contentRoot);
        else vm.updateVersioning(ref.contentType, versioningSlug, data, { author, contentRoot });
      }
      if (templateMode) return { entryDeleted: false };
      const dir = entryDir(ref.contentType, ref.slug);
      if (!hasAnyLiveLocale(dir, false) && countVariantFiles(dir, false) === 0 && fs.existsSync(dir)) {
        const del = await deleteContentEntry({
          type: ref.contentType,
          slug: ref.slug,
          author,
          contentRootName: ctx.contentRootName,
        });
        if (del.success) {
          ctx.contentIndex.refresh();
          return { entryDeleted: true };
        }
      }
      return { entryDeleted: false };
    },

    authorDiff(ref) {
      return authorDiff(withRoot(ref));
    },

    derivedKey(ref) {
      const r = withRoot(ref);
      const p = draftPathOf(r);
      if (!fs.existsSync(p)) return null;
      const raw = fs.readFileSync(p, "utf-8");
      const meta = readDraftMeta(p);
      const sourceHash = meta?.translated_from
        ? hashFileOrNull(livePathOf({ ...r, locale: meta.translated_from.locale }))
        : null;
      return [
        DERIVED_VIEW_VERSION,
        hashVariantFileContents(raw),
        meta?.based_on?.locale ?? "-",
        meta?.based_on?.common ?? "-",
        meta?.translated_from?.hash ?? "-",
        hashFileOrNull(livePathOf(r)) ?? "-",
        hashFileOrNull(commonPathOf(r)) ?? "-",
        sourceHash ?? "-",
      ].join("|");
    },

    checkBase(ref) {
      return checkDraftBase(withRoot(ref));
    },

    rebuild(ref, opts) {
      return rebuildDraftFromBase(withRoot(ref), opts);
    },

    checkSource(ref, withFields = true) {
      return checkTranslationSource(withRoot(ref), { withFields });
    },

    recordBase(ref, author) {
      recordDraftBase(withRoot(ref), { author });
    },

    recordSource(ref, sourceLocale, author) {
      recordTranslationSource(withRoot(ref), sourceLocale, { author });
    },
  };
  return store;
}
