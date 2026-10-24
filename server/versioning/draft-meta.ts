/**
 * `_draft` — reserved key inside a draft/variant file (`{variant}.{locale}.yml`).
 *
 * Holds where the draft came from (`based_on`), its translation source
 * (`translated_from`) and its open proposal link (`proposal`). It travels with the
 * draft through the content repo, never reaches a published file, and is ignored by
 * fingerprints so metadata changes never count as a content edit.
 */

import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import yaml from "js-yaml";
import { isTemplateVersioningSlug, variantTemplateBasename } from "@shared/sharedLayoutPaths";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { dumpContentYaml } from "../content-yaml";
import { getFolder } from "../content-types";
import { getDefaultContentRoot } from "../site-config";
import { markFileAsModified } from "../sync-state";
import { surgicalRemoveTopLevelKey } from "../seo-fields";

export const DRAFT_META_KEY = "_draft";

export type DraftBasedOn = {
  /** Hash of the live locale file when the draft was created; null = locale not published. */
  locale: string | null;
  /** Hash of `_common.yml` at that moment (null when missing). */
  common: string | null;
  at: string;
};

export type DraftTranslatedFrom = {
  locale: string;
  hash: string;
  at: string;
};

export type DraftProposalLink = {
  id: string;
  env: string;
  created_by_proposal?: boolean;
  created_fingerprint?: string;
  /** Set by the daily link check when the proposal is not open anywhere. */
  orphan_since?: string;
  /** Set when production could not be asked (token/network). */
  unverified_since?: string;
};

export type DraftMeta = {
  based_on?: DraftBasedOn;
  translated_from?: DraftTranslatedFrom;
  proposal?: DraftProposalLink;
};

/** `null` deletes that key from `_draft`; `undefined` leaves it alone. */
export type DraftMetaPatch = {
  [K in keyof DraftMeta]?: DraftMeta[K] | null;
};

/** Parse content YAML; unquoted `{{ var }}` template expressions stay strings. */
export function safeLoadYaml(raw: string): Record<string, unknown> | null {
  try {
    const { escaped, map } = escapeTemplateVars(raw);
    const parsed = yaml.load(escaped);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return unescapeObjectVars(parsed, map) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function safeDumpYaml(data: unknown): string {
  return dumpContentYaml(data, { lineWidth: -1, noRefs: true, sortKeys: false, quotingType: '"', forceQuotes: false });
}

const parseYaml = safeLoadYaml;

function normalizeMeta(raw: unknown): DraftMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: DraftMeta = {};
  if (o.based_on && typeof o.based_on === "object") {
    const b = o.based_on as Record<string, unknown>;
    out.based_on = {
      locale: typeof b.locale === "string" && b.locale ? b.locale : null,
      common: typeof b.common === "string" && b.common ? b.common : null,
      at: typeof b.at === "string" ? b.at : "",
    };
  }
  if (o.translated_from && typeof o.translated_from === "object") {
    const t = o.translated_from as Record<string, unknown>;
    if (typeof t.locale === "string" && typeof t.hash === "string") {
      out.translated_from = {
        locale: t.locale,
        hash: t.hash,
        at: typeof t.at === "string" ? t.at : "",
      };
    }
  }
  if (o.proposal && typeof o.proposal === "object") {
    const p = o.proposal as Record<string, unknown>;
    if (typeof p.id === "string" && p.id) {
      out.proposal = {
        id: p.id,
        env: typeof p.env === "string" && p.env ? p.env : "unknown",
        ...(p.created_by_proposal === true ? { created_by_proposal: true } : {}),
        ...(typeof p.created_fingerprint === "string"
          ? { created_fingerprint: p.created_fingerprint }
          : {}),
        ...(typeof p.orphan_since === "string" ? { orphan_since: p.orphan_since } : {}),
        ...(typeof p.unverified_since === "string" ? { unverified_since: p.unverified_since } : {}),
      };
    }
  }
  return Object.keys(out).length ? out : null;
}

/** Content hash of a YAML file; `_draft` metadata never counts as content. */
export function hashVariantFileContents(raw: string): string {
  return createHash("sha256").update(stripDraftMetaFromRaw(raw)).digest("hex").slice(0, 24);
}

/** Raw YAML text without the `_draft` block (formatting of the rest preserved). */
export function stripDraftMetaFromRaw(raw: string): string {
  if (!/^_draft\s*:/m.test(raw)) return raw;
  return surgicalRemoveTopLevelKey(raw, DRAFT_META_KEY);
}

export function readDraftMetaFromRaw(raw: string): DraftMeta | null {
  if (!/^_draft\s*:/m.test(raw)) return null;
  return normalizeMeta(parseYaml(raw)?.[DRAFT_META_KEY]);
}

export function readDraftMeta(filePath: string): DraftMeta | null {
  if (!fs.existsSync(filePath)) return null;
  return readDraftMetaFromRaw(fs.readFileSync(filePath, "utf-8"));
}

/** Parsed object without `_draft` (content loader, preview, promote). */
export function stripDraftMeta<T>(data: T): T {
  if (!data || typeof data !== "object" || Array.isArray(data)) return data;
  if (!(DRAFT_META_KEY in (data as Record<string, unknown>))) return data;
  const { [DRAFT_META_KEY]: _omit, ...rest } = data as Record<string, unknown>;
  return rest as T;
}

function applyPatch(current: DraftMeta | null, patch: DraftMetaPatch): DraftMeta | null {
  const next: DraftMeta = { ...(current ?? {}) };
  for (const key of Object.keys(patch) as Array<keyof DraftMeta>) {
    const v = patch[key];
    if (v === undefined) continue;
    if (v === null) delete next[key];
    else (next as Record<string, unknown>)[key] = v;
  }
  return Object.keys(next).length ? next : null;
}

function renderMetaBlock(meta: DraftMeta): string {
  return yaml.dump({ [DRAFT_META_KEY]: meta }, { lineWidth: 200, noRefs: true, sortKeys: false });
}

/** Bodies that parse to an empty document; a block `_draft:` key cannot follow a flow `{}`. */
const EMPTY_DOCUMENT_RE = /^(\{\s*\}|null|~)?$/;

/** Append `_draft` (or nothing) to content that no longer carries one. */
export function withDraftMeta(contentWithoutMeta: string, meta: DraftMeta | null): string {
  const base = stripDraftMetaFromRaw(contentWithoutMeta);
  if (!meta) return base.trim() || !contentWithoutMeta.trim() ? base : "{}\n";
  const trimmed = base.replace(/\s+$/, "");
  const body = EMPTY_DOCUMENT_RE.test(trimmed.trim()) ? "" : trimmed;
  return `${body ? `${body}\n` : ""}${renderMetaBlock(meta)}`;
}

function atomicWrite(filePath: string, content: string): void {
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf-8");
  fs.renameSync(tmp, filePath);
}

export type VariantWriteOpts = {
  author?: string;
  contentRoot?: string;
  /** Path handed to markFileAsModified (defaults to filePath). */
  relPath?: string;
  /** Skip sync tracking (tests / callers that mark themselves). */
  skipMark?: boolean;
};

function markWritten(filePath: string, opts: VariantWriteOpts): void {
  if (opts.skipMark) return;
  markFileAsModified(opts.relPath ?? filePath, opts.author, undefined, opts.contentRoot);
}

/**
 * Patch `_draft` in place. The rest of the YAML text is left byte-identical.
 * Returns the resulting meta (null when `_draft` was removed entirely).
 */
export function writeDraftMeta(
  filePath: string,
  patch: DraftMetaPatch,
  opts: VariantWriteOpts = {},
): DraftMeta | null {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  const next = applyPatch(readDraftMetaFromRaw(raw), patch);
  const out = withDraftMeta(raw, next);
  if (out !== raw) {
    atomicWrite(filePath, out);
    markWritten(filePath, opts);
  }
  return next;
}

type VariantWriteListener = (filePath: string, opts: VariantWriteOpts) => void;
const variantWriteListeners: VariantWriteListener[] = [];

/** Notified after every content write to a variant file (not `_draft`-only patches). */
export function onVariantWrite(listener: VariantWriteListener): () => void {
  variantWriteListeners.push(listener);
  return () => {
    const i = variantWriteListeners.indexOf(listener);
    if (i >= 0) variantWriteListeners.splice(i, 1);
  };
}

/** For writers that do not go through {@link writeVariantFile} (editor field writes). */
export function notifyVariantWritten(filePath: string, opts: VariantWriteOpts = {}): void {
  for (const listener of variantWriteListeners) {
    try {
      listener(filePath, opts);
    } catch {
      /* listeners never break a write */
    }
  }
}

export type VariantWriteResult = {
  warnings: Array<{ code: string; message: string }>;
};

/**
 * The single write path for variant files: keeps the existing `_draft` unless the
 * caller changes it through {@link writeDraftMeta}. A `_draft` block inside the
 * incoming content is ignored with a warning.
 */
export function writeVariantFile(
  filePath: string,
  content: string,
  opts: VariantWriteOpts & { meta?: DraftMeta | null } = {},
): VariantWriteResult {
  const warnings: VariantWriteResult["warnings"] = [];
  if (/^_draft\s*:/m.test(content) && opts.meta === undefined) {
    warnings.push({
      code: "draft_meta_ignored",
      message:
        "_draft is system metadata (base, translation source, proposal link) and cannot be written through content. It was kept as-is.",
    });
  }
  const existing = opts.meta !== undefined ? opts.meta : readDraftMeta(filePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  atomicWrite(filePath, withDraftMeta(content, existing));
  markWritten(filePath, opts);
  notifyVariantWritten(filePath, opts);
  return { warnings };
}

/** Rewrite a variant file from a parsed object (keeps `_draft`). */
export function writeVariantData(
  filePath: string,
  data: Record<string, unknown>,
  opts: VariantWriteOpts & { meta?: DraftMeta | null } = {},
): VariantWriteResult {
  return writeVariantFile(filePath, safeDumpYaml(stripDraftMeta(data)), opts);
}

/** Parsed variant data without `_draft` (null when missing/invalid). */
export function readVariantData(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  const parsed = parseYaml(fs.readFileSync(filePath, "utf-8"));
  return parsed ? stripDraftMeta(parsed) : null;
}

/** `{root}/{folder}/{slug}/{variant}.{locale}.yml` or type-root `template.{variant}.{locale}.yml`. */
export function variantFilePathFor(opts: {
  contentType: string;
  slug: string;
  variant: string;
  locale: string;
  contentRoot?: string;
}): string {
  const root = resolveRoot(opts.contentRoot);
  const folder = getFolder(opts.contentType, root);
  if (isTemplateVersioningSlug(opts.slug)) {
    return path.join(root, folder, variantTemplateBasename(opts.variant, opts.locale));
  }
  return path.join(root, folder, opts.slug, `${opts.variant}.${opts.locale}.yml`);
}

export function resolveRoot(contentRoot?: string): string {
  const root = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(root) ? root : path.join(process.cwd(), root);
}

/** Repo-relative path (for markFileAsModified / sync). */
export function relFromCwd(filePath: string): string {
  return path.relative(process.cwd(), filePath).replace(/\\/g, "/");
}
