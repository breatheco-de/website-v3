/**
 * Shared-layout structural sync helpers.
 *
 * Structured UI fans out allowlisted topology/layout across sibling
 * `single.{locale}.yml` files. Content props stay locale-local except on add
 * (full mirror + optional `_label` + hide on siblings).
 */

import * as fs from "fs";
import * as path from "path";
import { canonicalSectionId, sectionMatchesId } from "./utils/sectionIdentity";
import {
  LIVE_SHELL_BASENAME_RE,
  listSiblingLiveShellPaths,
  listAllLiveShellPaths,
  resolveTemplateLocalePath,
} from "./shared-layout-paths";

/** Same pattern as database-single-loader TEMPLATE_EXPR_RE (kept local to avoid circular imports). */
const TEMPLATE_EXPR_RE = /\{\{[\s\S]*?\}\}/;

/** Generic layout keys from sectionLayoutSchema that auto-fan-out. */
export const SHARED_LAYOUT_KEYS = [
  "load",
  "marginY",
  "paddingY",
  "marginX",
  "paddingX",
  "maxWidth",
  "background",
  "showOn",
  "showOnLocations",
  "showOnRegions",
] as const;

export type SharedLayoutKey = (typeof SHARED_LAYOUT_KEYS)[number];

/** Sentinel location slug: never matches a real location → section hidden publicly. */
export const HIDDEN_LOCATION_SENTINEL = "__none__";

/**
 * Section work label (`_label` on YAML sections).
 *
 * `requester` / `owner` store **staff ids** (immutable ids from the user store),
 * or special ids `"system"` / `"mcp"` for non-human actors.
 */
export interface SectionLabel {
  needs: "edit" | "review";
  /** Required human-readable reason shown in the editor. */
  note: string;
  /** Staff id (or system/mcp) of who assigned / last wrote the note. */
  requester?: string;
  /** Staff id of who must complete the work; null/omit = unassigned. */
  owner?: string | null;
}

/** Default note when a section is mirrored to a sibling locale and still needs copy work. */
export const MIRRORED_SECTION_NEEDS_EDIT_NOTE =
  "Mirrored from another locale — translate or adapt the copy, then save to clear this label and show the section publicly.";

export const SYSTEM_REQUESTER_ID = "system";
export const AGENT_REQUESTER_ID = "mcp";

/** Coerce legacy `{ kind, id }` objects or plain strings into a staff/special id string. */
export function coerceLabelActorId(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    const id = value.trim();
    return id || undefined;
  }
  if (typeof value === "object" && value !== null) {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id.trim();
  }
  return undefined;
}

export function isSharedLayoutKey(key: string): key is SharedLayoutKey {
  return (SHARED_LAYOUT_KEYS as readonly string[]).includes(key);
}

/** Field path under a section that is allowlisted for fan-out (e.g. showOn, paddingY.desktop). */
export function isAllowlistedSectionFieldPath(fieldPath: string): boolean {
  const root = fieldPath.split(".")[0];
  return isSharedLayoutKey(root);
}

/**
 * True when every non-allowlisted, non-identity prop is absent or a `{{ entry.* }}` expression.
 * Used to skip auto-label + auto-hide on siblings.
 */
export function sectionIsTemplateExpressionsOnly(section: Record<string, unknown>): boolean {
  const skip = new Set<string>([
    "type",
    "version",
    "variant",
    "section_id",
    "id",
    "_label",
    "_insertAfterSectionId",
    "_perEntrySource",
    "_perEntryPatched",
    ...SHARED_LAYOUT_KEYS,
  ]);

  for (const [key, value] of Object.entries(section)) {
    if (skip.has(key) || key.startsWith("_")) continue;
    if (!valueIsTemplateExprOrEmpty(value)) return false;
  }
  return true;
}

function valueIsTemplateExprOrEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return true;
    return TEMPLATE_EXPR_RE.test(trimmed) && !trimmed.replace(TEMPLATE_EXPR_RE, "").trim();
  }
  if (Array.isArray(value)) {
    return value.every((v) => valueIsTemplateExprOrEmpty(v));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every((v) => valueIsTemplateExprOrEmpty(v));
  }
  return false;
}

/** Hide from public visitors; staff still see the section in edit mode. */
export function hideSectionFromPublic(section: Record<string, unknown>): void {
  section.showOnLocations = [HIDDEN_LOCATION_SENTINEL];
}

export function isHiddenViaSentinel(section: Record<string, unknown>): boolean {
  const locs = section.showOnLocations;
  return Array.isArray(locs) && locs.length === 1 && locs[0] === HIDDEN_LOCATION_SENTINEL;
}

export function clearPublicHideIfSentinel(section: Record<string, unknown>): void {
  if (isHiddenViaSentinel(section)) {
    delete section.showOnLocations;
  }
}

export function assignSectionLabel(
  section: Record<string, unknown>,
  label: SectionLabel,
): void {
  const note = label.note?.trim();
  if (!note) {
    throw new Error('Section _label requires a non-empty "note" explaining why it needs work');
  }
  const requester =
    coerceLabelActorId(label.requester) ?? SYSTEM_REQUESTER_ID;
  const ownerRaw = label.owner;
  const owner =
    ownerRaw === null
      ? null
      : ownerRaw === undefined
        ? undefined
        : coerceLabelActorId(ownerRaw) ?? null;

  section._label = {
    needs: label.needs,
    note,
    requester,
    ...(owner !== undefined ? { owner } : {}),
  };
}

/**
 * Prepare a mirrored section for a sibling locale after add:
 * full payload copy, then optional `_label` + public hide.
 */
export function prepareSiblingMirroredSection(
  sourceSection: Record<string, unknown>,
  requesterId?: string,
): Record<string, unknown> {
  const mirrored = JSON.parse(JSON.stringify(sourceSection)) as Record<string, unknown>;
  if (!sectionIsTemplateExpressionsOnly(sourceSection)) {
    assignSectionLabel(mirrored, {
      needs: "edit",
      note: MIRRORED_SECTION_NEEDS_EDIT_NOTE,
      requester: requesterId || SYSTEM_REQUESTER_ID,
    });
    hideSectionFromPublic(mirrored);
  }
  return mirrored;
}

/** Copy only allowlisted layout keys from source onto target (by mutation). */
export function applyAllowlistedLayout(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): void {
  for (const key of SHARED_LAYOUT_KEYS) {
    if (key in source) {
      target[key] = JSON.parse(JSON.stringify(source[key]));
    } else if (key in target) {
      delete target[key];
    }
  }
}

/** Strip `_label` from sections before they reach React component props. */
export function stripSectionLabels<T>(data: T): T {
  if (data == null || typeof data !== "object") return data;
  if (Array.isArray(data)) {
    return data.map((item) => stripSectionLabels(item)) as T;
  }
  const obj = data as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === "_label") continue;
    out[k] = stripSectionLabels(v);
  }
  return out as T;
}

/**
 * List sibling live-shell paths for a content type directory (`template.*` prefer, legacy `single.*`).
 * Excludes the source locale file.
 */
export function listSiblingSinglePaths(
  templateDir: string,
  sourceLocale: string,
): Array<{ locale: string; filePath: string }> {
  return listSiblingLiveShellPaths(templateDir, sourceLocale).map((filePath) => {
    const name = path.basename(filePath);
    const m = LIVE_SHELL_BASENAME_RE.exec(name);
    return { locale: m?.[1] ?? "", filePath };
  }).filter((r) => r.locale);
}

/** List all live-shell locale files including source (prefer template.* when both). */
export function listAllSinglePaths(
  templateDir: string,
): Array<{ locale: string; filePath: string }> {
  return listAllLiveShellPaths(templateDir).map((filePath) => {
    const name = path.basename(filePath);
    const m = LIVE_SHELL_BASENAME_RE.exec(name);
    return { locale: m?.[1] ?? "", filePath };
  }).filter((r) => r.locale);
}

/**
 * Pick a mirror source for scaffolding a missing locale single:
 * prefer `en`, else first existing non-empty sections file.
 */
export function findBestSingleMirrorSource(
  templateDir: string,
  safeYamlLoad: (raw: string) => Record<string, unknown> | null,
): { locale: string; data: Record<string, unknown> } | null {
  const all = listAllSinglePaths(templateDir);
  const ordered = [
    ...all.filter((a) => a.locale === "en"),
    ...all.filter((a) => a.locale !== "en"),
  ];
  for (const { locale, filePath } of ordered) {
    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data = safeYamlLoad(raw);
      if (!data) continue;
      const sections = Array.isArray(data.sections) ? data.sections : [];
      if (sections.length > 0) return { locale, data };
    } catch {
      /* continue */
    }
  }
  return null;
}

/**
 * Build a new locale single by mirroring source sections (with label+hide where needed).
 */
export function buildMirroredLocaleSingle(
  sourceData: Record<string, unknown>,
  requesterId?: string,
): Record<string, unknown> {
  const meta = sourceData.meta && typeof sourceData.meta === "object"
    ? JSON.parse(JSON.stringify(sourceData.meta))
    : {
        page_title: "{{ entry.title }}",
        description: "{{ entry.description }}",
      };
  const sourceSections = Array.isArray(sourceData.sections)
    ? (sourceData.sections as Record<string, unknown>[])
    : [];
  const sections = sourceSections.map((s) => prepareSiblingMirroredSection(s, requesterId));
  return { meta, sections };
}

/** Remove a section by id from a sections array; returns whether anything was removed. */
export function removeSectionById(
  sections: Record<string, unknown>[],
  sectionId: string,
): { sections: Record<string, unknown>[]; removed: boolean } {
  const next = sections.filter((s) => !sectionMatchesId(s, sectionId));
  return { sections: next, removed: next.length !== sections.length };
}

/** Reorder sibling sections to match an ordered list of section_ids (preserve content). */
export function reorderSectionsByIds(
  sections: Record<string, unknown>[],
  orderedIds: string[],
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const s of sections) {
    const id = canonicalSectionId(s);
    if (id) byId.set(id, s);
  }
  const result: Record<string, unknown>[] = [];
  const used = new Set<string>();
  for (const id of orderedIds) {
    const s = byId.get(id);
    if (s) {
      result.push(s);
      used.add(id);
    }
  }
  for (const s of sections) {
    const id = canonicalSectionId(s);
    if (!id || !used.has(id)) result.push(s);
  }
  return result;
}

/** Strip patches for a deleted section_id from an entry overlay file's sections array. */
export function stripSectionFromEntryOverlay(
  entryData: Record<string, unknown>,
  sectionId: string,
): boolean {
  if (!Array.isArray(entryData.sections)) return false;
  const before = entryData.sections.length;
  entryData.sections = (entryData.sections as Record<string, unknown>[]).filter(
    (s) => !sectionMatchesId(s, sectionId),
  );
  return entryData.sections.length !== before;
}

export interface FanOutResult {
  succeeded: string[];
  failed: Array<{ locale: string; error: string }>;
  /** True when type/version/variant changed on source and siblings were NOT updated. */
  manualVariantWarning?: boolean;
}

/** Write YAML only when bytes change. Returns true when the file was written. */
function writeYamlFile(
  filePath: string,
  data: Record<string, unknown>,
  dump: (data: unknown) => string,
): boolean {
  const body = dump(data);
  const next = body.endsWith("\n") ? body : `${body}\n`;
  if (fs.existsSync(filePath)) {
    const prev = fs.readFileSync(filePath, "utf-8");
    const prevNorm = prev.endsWith("\n") ? prev : prev.length > 0 ? `${prev}\n` : "";
    if (prevNorm === next) return false;
  }
  fs.writeFileSync(filePath, next, "utf-8");
  return true;
}

/**
 * Fan out structural ops from a source `single.{locale}.yml` to sibling singles.
 * Call after the source file has already been updated.
 */
export function fanOutStructuralOpsToSiblings(opts: {
  templateDir: string;
  sourceLocale: string;
  sourceSections: Record<string, unknown>[];
  operations: Array<Record<string, unknown>>;
  safeYamlLoad: (raw: string) => Record<string, unknown> | null;
  dumpYaml: (data: unknown) => string;
  requesterId?: string;
  onSiblingWritten?: (filePath: string, locale: string) => void;
  /** Clean entry overlays across the type when sections are deleted */
  cleanEntryOverlaysForSectionIds?: (sectionIds: string[]) => void;
}): FanOutResult {
  const {
    templateDir,
    sourceLocale,
    sourceSections,
    operations,
    safeYamlLoad,
    dumpYaml,
    requesterId,
    onSiblingWritten,
    cleanEntryOverlaysForSectionIds,
  } = opts;

  const siblings = listSiblingSinglePaths(templateDir, sourceLocale);
  const result: FanOutResult = { succeeded: [], failed: [] };
  if (siblings.length === 0) return result;

  const deletedIds: string[] = [];
  let needsReorder = false;
  let manualVariantWarning = false;
  const addedById = new Map<string, { section: Record<string, unknown>; index: number }>();
  const layoutUpdatesById = new Map<string, Record<string, unknown>>();

  for (const op of operations) {
    const action = op.action as string;
    if (action === "add_item" && op.path === "sections") {
      const section = (op.value ?? op.item ?? op.section) as Record<string, unknown> | undefined;
      if (!section || typeof section !== "object") continue;
      const id = canonicalSectionId(section);
      if (!id) continue;
      const index =
        typeof op.index === "number"
          ? op.index
          : sourceSections.findIndex((s) => sectionMatchesId(s, id));
      addedById.set(id, {
        section: sourceSections.find((s) => sectionMatchesId(s, id)) ?? section,
        index: index >= 0 ? index : sourceSections.length,
      });
    } else if (action === "remove_item" && op.path === "sections") {
      const idx = typeof op.index === "number" ? op.index : -1;
      // Prefer section_id on the op if present; else we need pre-delete snapshot.
      // Callers should pass sectionId in op when available.
      const sectionId =
        (typeof op.sectionId === "string" && op.sectionId) ||
        (typeof op.section_id === "string" && op.section_id) ||
        null;
      if (sectionId) deletedIds.push(sectionId);
      else if (idx >= 0) {
        // Index-based remove: compare ordered ids — handled via full topology sync below
        needsReorder = true;
      }
    } else if (action === "reorder_sections") {
      needsReorder = true;
    } else if (action === "update_section") {
      const section = op.section as Record<string, unknown> | undefined;
      const idx = typeof op.index === "number" ? op.index : -1;
      const sourceSec =
        section ??
        (idx >= 0 ? sourceSections[idx] : undefined);
      if (!sourceSec) continue;
      const id = canonicalSectionId(sourceSec);
      if (!id) continue;

      if (op.structural === true) {
        // Detect type/version/variant-only vs layout — we still fan layout; variant warns
        const layoutPatch: Record<string, unknown> = {};
        for (const key of SHARED_LAYOUT_KEYS) {
          if (key in sourceSec) layoutPatch[key] = sourceSec[key];
        }
        if (Object.keys(layoutPatch).length > 0) {
          layoutUpdatesById.set(id, layoutPatch);
        }
        // Changing type/version/variant is warn-only (do not copy those fields)
        manualVariantWarning = true;
      } else {
        const layoutPatch: Record<string, unknown> = {};
        for (const key of SHARED_LAYOUT_KEYS) {
          if (key in sourceSec) layoutPatch[key] = sourceSec[key];
        }
        if (Object.keys(layoutPatch).length > 0) {
          layoutUpdatesById.set(id, layoutPatch);
        }
      }
    } else if (action === "update_field") {
      const pathStr = String(op.path || "");
      const m = pathStr.match(/^sections\.(\d+)\.(.+)$/);
      if (!m) continue;
      const idx = parseInt(m[1], 10);
      const fieldPath = m[2];
      if (!isAllowlistedSectionFieldPath(fieldPath)) continue;
      const sourceSec = sourceSections[idx];
      if (!sourceSec) continue;
      const id = canonicalSectionId(sourceSec);
      if (!id) continue;
      const root = fieldPath.split(".")[0];
      const existing = layoutUpdatesById.get(id) ?? {};
      if (root in sourceSec) existing[root] = sourceSec[root];
      layoutUpdatesById.set(id, existing);
    }
  }

  // If source and siblings may have diverged on presence, sync topology from source order
  const sourceOrderedIds = sourceSections
    .map((s) => canonicalSectionId(s))
    .filter((id): id is string => !!id);

  // Infer deletes: ids that were in sibling but not in source after ops
  // We'll compute per sibling.

  for (const { locale, filePath } of siblings) {
    try {
      if (!fs.existsSync(filePath)) {
        // Create from mirrored source sections
        const mirrored = {
          meta: {
            page_title: "{{ entry.title }}",
            description: "{{ entry.description }}",
          },
          sections: sourceSections.map((s) => prepareSiblingMirroredSection(s, requesterId)),
        };
        if (writeYamlFile(filePath, mirrored, dumpYaml)) {
          onSiblingWritten?.(filePath, locale);
        }
        result.succeeded.push(locale);
        continue;
      }

      const raw = fs.readFileSync(filePath, "utf-8");
      const data = safeYamlLoad(raw) || {};
      let sections = Array.isArray(data.sections)
        ? [...(data.sections as Record<string, unknown>[])]
        : [];

      // Deletes: remove ids present before but not in sourceOrderedIds, plus explicit deletedIds
      const siblingIds = new Set(
        sections.map((s) => canonicalSectionId(s)).filter((id): id is string => !!id),
      );
      for (const id of siblingIds) {
        if (!sourceOrderedIds.includes(id) || deletedIds.includes(id)) {
          const r = removeSectionById(sections, id);
          sections = r.sections;
          if (r.removed && !deletedIds.includes(id)) deletedIds.push(id);
        }
      }

      // Adds
      for (const [id, { section, index }] of addedById) {
        if (sections.some((s) => sectionMatchesId(s, id))) continue;
        const mirrored = prepareSiblingMirroredSection(section, requesterId);
        const insertAt = Math.min(Math.max(index, 0), sections.length);
        sections.splice(insertAt, 0, mirrored);
      }

      // Layout updates
      for (const [id, layoutPatch] of layoutUpdatesById) {
        const target = sections.find((s) => sectionMatchesId(s, id));
        if (!target) continue;
        applyAllowlistedLayout(target, { ...target, ...layoutPatch });
      }

      // Reorder to match source
      if (needsReorder || addedById.size > 0 || deletedIds.length > 0) {
        sections = reorderSectionsByIds(sections, sourceOrderedIds);
      }

      data.sections = sections;
      if (writeYamlFile(filePath, data, dumpYaml)) {
        onSiblingWritten?.(filePath, locale);
      }
      result.succeeded.push(locale);
    } catch (err) {
      result.failed.push({
        locale,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (deletedIds.length > 0 && cleanEntryOverlaysForSectionIds) {
    try {
      cleanEntryOverlaysForSectionIds([...new Set(deletedIds)]);
    } catch {
      /* non-fatal */
    }
  }

  if (manualVariantWarning) result.manualVariantWarning = true;
  return result;
}

/** True when entry `_common.yml` has `detached: true` (local read; no contentType needed). */
function entryDirIsDetached(
  entryDir: string,
  safeYamlLoad: (raw: string) => Record<string, unknown> | null,
): boolean {
  const commonPath = path.join(entryDir, "_common.yml");
  if (!fs.existsSync(commonPath)) return false;
  try {
    const parsed = safeYamlLoad(fs.readFileSync(commonPath, "utf-8"));
    return parsed?.detached === true;
  } catch {
    return false;
  }
}

/** Clean a deleted section_id from all entry overlay YAML files under a type dir. */
export function cleanSectionIdFromEntryOverlays(
  templateDir: string,
  sectionIds: string[],
  safeYamlLoad: (raw: string) => Record<string, unknown> | null,
  dumpYaml: (data: unknown) => string,
  onWritten?: (filePath: string) => void,
): void {
  if (!fs.existsSync(templateDir) || sectionIds.length === 0) return;
  for (const name of fs.readdirSync(templateDir)) {
    const entryDir = path.join(templateDir, name);
    if (!fs.statSync(entryDir).isDirectory()) continue;
    if (name.startsWith(".") || name === "node_modules") continue;
    // Detached entries own full structure — never strip sections from template cleanup
    if (entryDirIsDetached(entryDir, safeYamlLoad)) continue;
    for (const file of fs.readdirSync(entryDir)) {
      if (!/\.ya?ml$/i.test(file) || file.startsWith("_") || file === "versioning.yml") continue;
      const filePath = path.join(entryDir, file);
      try {
        const data = safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
        if (!data) continue;
        let dirty = false;
        for (const id of sectionIds) {
          if (stripSectionFromEntryOverlay(data, id)) dirty = true;
        }
        if (dirty) {
          if (writeYamlFile(filePath, data, dumpYaml)) {
            onWritten?.(filePath);
          }
        }
      } catch {
        /* skip */
      }
    }
  }
}


/** Align all sibling single.*.yml files to a base locale's section structure. */
export function alignSiblingSinglesToBase(opts: {
  templateDir: string;
  baseLocale: string;
  safeYamlLoad: (raw: string) => Record<string, unknown> | null;
  dumpYaml: (data: unknown) => string;
  requesterId?: string;
  onWritten?: (filePath: string, locale: string) => void;
}): FanOutResult {
  const { templateDir, baseLocale, safeYamlLoad, dumpYaml, requesterId, onWritten } = opts;
  const basePath = resolveTemplateLocalePath(templateDir, baseLocale, { fallbackLocale: "" });
  const result: FanOutResult = { succeeded: [], failed: [] };
  if (!fs.existsSync(basePath)) {
    result.failed.push({ locale: baseLocale, error: "Base template shell not found" });
    return result;
  }
  const baseData = safeYamlLoad(fs.readFileSync(basePath, "utf-8"));
  if (!baseData) {
    result.failed.push({ locale: baseLocale, error: "Could not parse base template shell" });
    return result;
  }
  const baseSections = Array.isArray(baseData.sections)
    ? (baseData.sections as Record<string, unknown>[])
    : [];

  for (const { locale, filePath } of listAllSinglePaths(templateDir)) {
    if (locale === baseLocale) {
      result.succeeded.push(locale);
      continue;
    }
    try {
      let data: Record<string, unknown> = {};
      if (fs.existsSync(filePath)) {
        data = safeYamlLoad(fs.readFileSync(filePath, "utf-8")) || {};
      }
      const existingSections = Array.isArray(data.sections)
        ? (data.sections as Record<string, unknown>[])
        : [];

      if (existingSections.length === 0) {
        const mirrored = buildMirroredLocaleSingle(baseData, requesterId);
        if (data.meta) mirrored.meta = data.meta;
        writeYamlFile(filePath, mirrored, dumpYaml);
      } else {
        const byId = new Map<string, Record<string, unknown>>();
        for (const s of existingSections) {
          const id = canonicalSectionId(s);
          if (id) byId.set(id, s);
        }
        const next: Record<string, unknown>[] = [];
        for (const baseSec of baseSections) {
          const id = canonicalSectionId(baseSec);
          if (!id) continue;
          if (byId.has(id)) {
            const existing = byId.get(id)!;
            applyAllowlistedLayout(existing, baseSec);
            next.push(existing);
            byId.delete(id);
          } else {
            next.push(prepareSiblingMirroredSection(baseSec, requesterId));
          }
        }
        for (const leftover of byId.values()) {
          if (!leftover._label) {
            assignSectionLabel(leftover, {
              needs: "review",
              note: "Unmatched after shared-layout align",
              requester: requesterId || SYSTEM_REQUESTER_ID,
            });
          }
          next.push(leftover);
        }
        data.sections = next;
        writeYamlFile(filePath, data, dumpYaml);
      }
      onWritten?.(filePath, locale);
      result.succeeded.push(locale);
    } catch (err) {
      result.failed.push({
        locale,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

/** Summarize section topology per locale single for enablement UI. */
export function summarizeSingleTemplateLocales(
  templateDir: string,
  safeYamlLoad: (raw: string) => Record<string, unknown> | null,
): Array<{ locale: string; sectionCount: number; sectionIds: string[] }> {
  return listAllSinglePaths(templateDir).map(({ locale, filePath }) => {
    try {
      const data = safeYamlLoad(fs.readFileSync(filePath, "utf-8"));
      const sections = Array.isArray(data?.sections)
        ? (data!.sections as Record<string, unknown>[])
        : [];
      const sectionIds = sections
        .map((s) => canonicalSectionId(s))
        .filter((id): id is string => !!id);
      return { locale, sectionCount: sections.length, sectionIds };
    } catch {
      return { locale, sectionCount: 0, sectionIds: [] };
    }
  });
}
