/**
 * Server enforcement for editor.<field>.deprecated.
 *
 * An entry is "old" for a deprecated field when its live files (`_common.yml` or any
 * live `{locale}.yml`) store a non-empty value. Drafts / variants / field_mapping defaults
 * do not count. DB-backed types only consider the locale-file `field_overrides` bag
 * (DB column values keep flowing and are never blocked).
 */

import fs from "fs";
import path from "path";
import { dumpContentYaml, loadContentYamlObject } from "./content-yaml";
import {
  DEPRECATED_FIELD_CODE,
  deprecatedFieldMessage,
  isNonEmptyFieldValue,
  listDeprecatedFields,
  type DeprecatedFieldConfig,
} from "@shared/deprecatedField";
import { ENTRY_OR_SINGLE_VAR_PATTERN } from "@shared/entryTemplateVars";
import { getContentTypeConfig, type ContentTypeEditorHint } from "./content-types";
import { getEntryContentDir } from "./draft-entry";
import { mappedFieldsStorageFor, type MappedFieldsStorage } from "./mapped-fields-storage";

const LIVE_LOCALE_FILE_RE = /^[a-z]{2}(-[a-z]{2})?\.ya?ml$/;
const FIELD_OVERRIDES_KEY = "field_overrides";

/** Top-level entry keys that are never content-type mapped fields. */
const NON_FIELD_ROOT_KEYS = new Set(["sections", "meta", "seo", "layout", "funnel", "slug", "variant"]);

export type DeprecatedWriteFailure = {
  ok: false;
  code: typeof DEPRECATED_FIELD_CODE;
  error: string;
  field: string;
  replaced_by: string | null;
  reason: string | null;
  field_path: string;
};

/** Structured payload attached to HTTP / MCP failures. */
export type DeprecatedFieldErrorInfo = {
  field: string;
  replaced_by: string | null;
  reason: string | null;
  field_path?: string;
};

export function deprecatedErrorInfo(f: DeprecatedWriteFailure): DeprecatedFieldErrorInfo {
  return { field: f.field, replaced_by: f.replaced_by, reason: f.reason, field_path: f.field_path };
}

export function getDeprecatedFieldsForType(
  contentType: string,
  contentRoot?: string,
): Record<string, DeprecatedFieldConfig> {
  const config = getContentTypeConfig(contentType, contentRoot);
  return listDeprecatedFields(config?.editor as Record<string, ContentTypeEditorHint> | undefined);
}

function readYamlObject(filePath: string): Record<string, unknown> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return loadContentYamlObject(fs.readFileSync(filePath, "utf-8"));
  } catch {
    return null;
  }
}

function liveEntryFiles(contentDir: string): string[] {
  if (!fs.existsSync(contentDir)) return [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(contentDir);
  } catch {
    return [];
  }
  const out: string[] = [];
  if (names.includes("_common.yml")) out.push(path.join(contentDir, "_common.yml"));
  for (const n of names) {
    if (LIVE_LOCALE_FILE_RE.test(n)) out.push(path.join(contentDir, n));
  }
  return out;
}

/**
 * True when `_common.yml` or any live `{locale}.yml` of the entry stores a non-empty value
 * for `field` (root key for static types; `field_overrides[field]` for DB-backed types).
 */
export function entryHasLiveStoredValue(
  contentType: string,
  slug: string,
  field: string,
  contentRoot?: string,
): boolean {
  if (!getContentTypeConfig(contentType, contentRoot)) return false;
  const inBag = mappedFieldsStorageFor(contentType, contentRoot) === "field_overrides";
  let dir: string;
  try {
    dir = getEntryContentDir(contentType, slug, contentRoot);
  } catch {
    return false;
  }
  for (const file of liveEntryFiles(dir)) {
    const data = readYamlObject(file);
    if (!data) continue;
    if (inBag) {
      const bag = data[FIELD_OVERRIDES_KEY];
      if (bag && typeof bag === "object" && isNonEmptyFieldValue((bag as Record<string, unknown>)[field])) {
        return true;
      }
    } else if (isNonEmptyFieldValue(data[field])) {
      return true;
    }
  }
  return false;
}

/** Root field name for a write path (`author.name` → `author`); null for non-field roots. */
export function rootFieldFromPath(fieldPath: string): string | null {
  const trimmed = fieldPath.trim();
  if (!trimmed) return null;
  let root = trimmed.split(/[.[]/)[0];
  if (root === FIELD_OVERRIDES_KEY) {
    const rest = trimmed.slice(FIELD_OVERRIDES_KEY.length + 1);
    root = rest.split(/[.[]/)[0];
  }
  if (!root || NON_FIELD_ROOT_KEYS.has(root)) return null;
  return root;
}

function failure(field: string, cfg: DeprecatedFieldConfig, fieldPath: string): DeprecatedWriteFailure {
  return {
    ok: false,
    code: DEPRECATED_FIELD_CODE,
    error: deprecatedFieldMessage(field, cfg),
    field,
    replaced_by: cfg.replaced_by,
    reason: cfg.reason ?? null,
    field_path: fieldPath,
  };
}

/** `update_field` ops → `{ path, value }` rows for {@link checkDeprecatedWrites}. */
export function updateFieldOpsToWrites(
  ops: ReadonlyArray<unknown>,
): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  for (const raw of ops) {
    const op = raw as { action?: unknown; path?: unknown; value?: unknown };
    if (op?.action !== "update_field" || typeof op.path !== "string") continue;
    out.push({ path: op.path, value: op.value });
  }
  return out;
}

/**
 * Reject writes that set a non-empty value on a deprecated field when the entry's live files
 * do not already store one. Clearing (null / empty) is always allowed.
 */
export function checkDeprecatedWrites(opts: {
  contentType: string;
  slug: string;
  contentRoot?: string;
  updates: Array<{ path: string; value: unknown }> | Record<string, unknown>;
}): { ok: true } | DeprecatedWriteFailure {
  const deprecated = getDeprecatedFieldsForType(opts.contentType, opts.contentRoot);
  if (Object.keys(deprecated).length === 0) return { ok: true };
  const list = Array.isArray(opts.updates)
    ? opts.updates
    : Object.entries(opts.updates).map(([p, value]) => ({ path: p, value }));
  for (const { path: fieldPath, value } of list) {
    const root = rootFieldFromPath(fieldPath);
    if (!root) continue;
    const cfg = deprecated[root];
    if (!cfg) continue;
    if (!isNonEmptyFieldValue(value)) continue;
    if (entryHasLiveStoredValue(opts.contentType, opts.slug, root, opts.contentRoot)) continue;
    return failure(root, cfg, fieldPath);
  }
  return { ok: true };
}

/**
 * For a whole-file write (raw YAML / promote): reject new or changed deprecated root keys
 * when the entry's live files do not already store the field.
 */
export function checkDeprecatedFileWrite(opts: {
  contentType: string;
  slug: string;
  contentRoot?: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}): { ok: true } | DeprecatedWriteFailure {
  const deprecated = getDeprecatedFieldsForType(opts.contentType, opts.contentRoot);
  if (Object.keys(deprecated).length === 0 || !opts.after) return { ok: true };
  const inBag = mappedFieldsStorageFor(opts.contentType, opts.contentRoot) === "field_overrides";
  const pick = (obj: Record<string, unknown> | null, field: string): unknown => {
    if (!obj) return undefined;
    if (inBag) {
      const bag = obj[FIELD_OVERRIDES_KEY];
      return bag && typeof bag === "object" ? (bag as Record<string, unknown>)[field] : undefined;
    }
    return obj[field];
  };
  for (const [field, cfg] of Object.entries(deprecated)) {
    const next = pick(opts.after, field);
    if (!isNonEmptyFieldValue(next)) continue;
    const prev = pick(opts.before, field);
    if (JSON.stringify(prev) === JSON.stringify(next)) continue;
    if (entryHasLiveStoredValue(opts.contentType, opts.slug, field, opts.contentRoot)) continue;
    return failure(field, cfg, inBag ? `${FIELD_OVERRIDES_KEY}.${field}` : field);
  }
  return { ok: true };
}

/**
 * Remove deprecated root keys (and field_overrides entries) from a parsed entry object.
 * Returns the removed field names. Mutates `obj`.
 */
export function stripDeprecatedKeys(
  obj: Record<string, unknown> | null | undefined,
  editor: Record<string, ContentTypeEditorHint> | null | undefined,
): string[] {
  if (!obj) return [];
  const deprecated = listDeprecatedFields(editor);
  const removed: string[] = [];
  for (const field of Object.keys(deprecated)) {
    if (Object.prototype.hasOwnProperty.call(obj, field)) {
      delete obj[field];
      removed.push(field);
    }
    const bag = obj[FIELD_OVERRIDES_KEY];
    if (bag && typeof bag === "object" && !Array.isArray(bag) && field in (bag as object)) {
      delete (bag as Record<string, unknown>)[field];
      if (!removed.includes(field)) removed.push(field);
    }
  }
  return removed;
}

/**
 * Strip deprecated keys from every YAML file in an entry folder (cross-type duplicate).
 * Returns removed field names.
 */
export function stripDeprecatedFromEntryFolder(
  folderPath: string,
  editor: Record<string, ContentTypeEditorHint> | null | undefined,
): string[] {
  if (Object.keys(listDeprecatedFields(editor)).length === 0) return [];
  if (!fs.existsSync(folderPath)) return [];
  const removed = new Set<string>();
  for (const name of fs.readdirSync(folderPath)) {
    if (!/\.ya?ml$/.test(name) || name.startsWith("versioning.")) continue;
    const filePath = path.join(folderPath, name);
    const data = readYamlObject(filePath);
    if (!data) continue;
    const gone = stripDeprecatedKeys(data, editor);
    if (gone.length === 0) continue;
    gone.forEach((f) => removed.add(f));
    fs.writeFileSync(filePath, dumpContentYaml(data, { lineWidth: 120, noRefs: true, sortKeys: false }, filePath), "utf-8");
  }
  return Array.from(removed);
}

/** Success-payload fields for duplicates that dropped deprecated keys. */
export function deprecatedStripPayload(
  stripped: Iterable<string>,
  deprecated: Record<string, DeprecatedFieldConfig>,
): { stripped_deprecated_fields?: Array<{ field: string; replaced_by: string | null }>; warnings?: string[] } {
  const fields = Array.from(new Set(stripped));
  if (fields.length === 0) return {};
  return {
    stripped_deprecated_fields: fields.map((f) => ({ field: f, replaced_by: deprecated[f]?.replaced_by ?? null })),
    warnings: fields.map((f) => {
      const r = deprecated[f]?.replaced_by;
      return r
        ? `Dropped deprecated field "${f}" from the copy; set "${r}" instead. The source entry is unchanged.`
        : `Dropped deprecated field "${f}" from the copy (no replacement). The source entry is unchanged.`;
    }),
  };
}

export type FieldUsageReport = {
  field: string;
  /** Repo-relative files that reference {{ entry.<field> }} / {{ single.<field> }} in this type. */
  files: string[];
  /** field_mapping default (undefined when the mapping has no default). */
  default_value?: string | null;
};

/**
 * Files in this content type (entries + type-level template shells) that reference the field.
 * Uses the ContentIndex variable-usage map plus a direct scan of `<type>/` top-level YAML shells.
 */
export function findFieldUsages(opts: {
  contentType: string;
  field: string;
  contentRoot: string;
  getVariableUsage: (name: string) => string[];
}): FieldUsageReport {
  const { contentType, field, contentRoot } = opts;
  const config = getContentTypeConfig(contentType, contentRoot);
  const folder = config?.directory;
  const out = new Set<string>();
  if (folder) {
    const folderMarker = `/${folder}/`;
    for (const name of [`entry.${field}`, `single.${field}`]) {
      for (const f of opts.getVariableUsage(name)) {
        const norm = f.replace(/\\/g, "/");
        if (norm.includes(folderMarker) || norm.startsWith(`${folder}/`)) out.add(norm);
      }
    }
    const typeDir = path.join(contentRoot, folder);
    const re = new RegExp(`\\{\\{\\s*(?:entry|single)\\.${escapeRegExp(field)}(?![a-zA-Z0-9_])`);
    try {
      for (const name of fs.readdirSync(typeDir)) {
        if (!/\.ya?ml$/.test(name)) continue;
        const full = path.join(typeDir, name);
        try {
          if (re.test(fs.readFileSync(full, "utf-8"))) {
            out.add(path.relative(process.cwd(), full).replace(/\\/g, "/"));
          }
        } catch {
          /* unreadable shell */
        }
      }
    } catch {
      /* missing type dir */
    }
  }
  const report: FieldUsageReport = { field, files: Array.from(out).sort() };
  const mapping = config?.field_mapping?.[field];
  if (mapping && typeof mapping === "object" && "default" in mapping) {
    report.default_value = mapping.default;
  }
  return report;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type DeprecatedTypeDirScan = {
  /** field → files (relative to typeDir) with {{ entry.<field> }} / {{ single.<field> }}. */
  templateRefs: Record<string, string[]>;
  /** field → entry slugs whose only stored value is in a draft/variant file (publish will reject). */
  draftOnlyValues: Record<string, string[]>;
};

/**
 * Read-only scan of one content-type folder (type-level shells + one level of entry folders)
 * for validator reporting. Does not consult ContentIndex.
 */
export function scanTypeDirForDeprecatedFields(
  typeDir: string,
  fields: string[],
  opts?: { storage?: MappedFieldsStorage },
): DeprecatedTypeDirScan {
  const out: DeprecatedTypeDirScan = { templateRefs: {}, draftOnlyValues: {} };
  if (fields.length === 0 || !fs.existsSync(typeDir)) return out;
  const refRes = fields.map(
    (f) => [f, new RegExp(`\\{\\{\\s*(?:entry|single)\\.${escapeRegExp(f)}(?![a-zA-Z0-9_])`)] as const,
  );
  const addRef = (field: string, rel: string) => {
    (out.templateRefs[field] ??= []).push(rel);
  };
  const scanText = (abs: string, rel: string) => {
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf-8");
    } catch {
      return;
    }
    for (const [field, re] of refRes) if (re.test(text)) addRef(field, rel);
  };
  const storedValue = (data: Record<string, unknown> | null, field: string): boolean => {
    if (!data) return false;
    if (opts?.storage === "field_overrides") {
      const bag = data[FIELD_OVERRIDES_KEY];
      return !!bag && typeof bag === "object" && isNonEmptyFieldValue((bag as Record<string, unknown>)[field]);
    }
    return isNonEmptyFieldValue(data[field]);
  };

  let names: string[] = [];
  try {
    names = fs.readdirSync(typeDir);
  } catch {
    return out;
  }
  for (const name of names) {
    const abs = path.join(typeDir, name);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(abs);
    } catch {
      continue;
    }
    if (stat.isFile()) {
      if (/\.ya?ml$/.test(name)) scanText(abs, name);
      continue;
    }
    if (!stat.isDirectory() || name.startsWith(".")) continue;
    let entryFiles: string[] = [];
    try {
      entryFiles = fs.readdirSync(abs).filter((n) => /\.ya?ml$/.test(n));
    } catch {
      continue;
    }
    const liveFiles = entryFiles.filter((n) => n === "_common.yml" || LIVE_LOCALE_FILE_RE.test(n));
    const otherFiles = entryFiles.filter(
      (n) => !liveFiles.includes(n) && n !== "versioning.yml" && !n.startsWith("_product"),
    );
    for (const n of entryFiles) scanText(path.join(abs, n), `${name}/${n}`);
    const liveData = liveFiles.map((n) => readYamlObject(path.join(abs, n)));
    const otherData = otherFiles.map((n) => readYamlObject(path.join(abs, n)));
    for (const field of fields) {
      if (liveData.some((d) => storedValue(d, field))) continue;
      if (otherData.some((d) => storedValue(d, field))) {
        (out.draftOnlyValues[field] ??= []).push(name);
      }
    }
  }
  return out;
}

export type DeprecatedTemplateRef = {
  field: string;
  replaced_by: string | null;
  section_path: string;
  variable: string;
};

function collectVarRefs(
  node: unknown,
  pathPrefix: string,
  deprecated: Record<string, DeprecatedFieldConfig>,
  out: Map<string, DeprecatedTemplateRef>,
): void {
  if (typeof node === "string") {
    if (!node.includes("{{")) return;
    const re = new RegExp(ENTRY_OR_SINGLE_VAR_PATTERN.source, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(node)) !== null) {
      const fieldPath = m[1];
      if (!fieldPath) continue;
      const varName = m[0].includes("single.") ? `single.${fieldPath}` : `entry.${fieldPath}`;
      const root = fieldPath.split(/[.[]/)[0];
      const cfg = deprecated[root];
      if (!cfg) continue;
      const key = `${pathPrefix}|${root}`;
      if (!out.has(key)) {
        out.set(key, { field: root, replaced_by: cfg.replaced_by, section_path: pathPrefix, variable: varName });
      }
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((child, i) => collectVarRefs(child, `${pathPrefix}[${i}]`, deprecated, out));
    return;
  }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      collectVarRefs(v, pathPrefix ? `${pathPrefix}.${k}` : k, deprecated, out);
    }
  }
}

function refFieldsIn(
  node: unknown,
  deprecated: Record<string, DeprecatedFieldConfig>,
): Map<string, number> {
  const out = new Map<string, DeprecatedTemplateRef>();
  collectVarRefs(node, "", deprecated, out);
  const counts = new Map<string, number>();
  out.forEach((r) => counts.set(r.field, (counts.get(r.field) ?? 0) + 1));
  return counts;
}

/**
 * `{{ entry.X }}` / `{{ single.X }}` references to deprecated fields that are new in `after`
 * compared with `before` (per field, by occurrence count). Warning-only helper.
 */
export function findNewDeprecatedVarRefs(
  before: unknown,
  after: unknown,
  deprecated: Record<string, DeprecatedFieldConfig>,
  pathPrefix = "sections",
): DeprecatedTemplateRef[] {
  if (Object.keys(deprecated).length === 0) return [];
  const beforeCounts = refFieldsIn(before, deprecated);
  const afterRefs = new Map<string, DeprecatedTemplateRef>();
  collectVarRefs(after, pathPrefix, deprecated, afterRefs);
  const afterCounts = new Map<string, number>();
  afterRefs.forEach((r) => afterCounts.set(r.field, (afterCounts.get(r.field) ?? 0) + 1));
  const out: DeprecatedTemplateRef[] = [];
  afterCounts.forEach((count, field) => {
    if (count <= (beforeCounts.get(field) ?? 0)) return;
    afterRefs.forEach((r) => {
      if (r.field === field) out.push(r);
    });
  });
  return out;
}

export function deprecatedTemplateRefWarning(ref: DeprecatedTemplateRef): { code: string; message: string } {
  const replacement = ref.replaced_by ? ` Use {{ entry.${ref.replaced_by} }} instead.` : " It has no replacement.";
  return {
    code: "deprecated_template_ref",
    message:
      `${ref.section_path} references {{ ${ref.variable} }}, a deprecated field — new entries cannot set it, so it renders empty/default there.` +
      replacement,
  };
}
