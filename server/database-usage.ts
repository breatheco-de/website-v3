/**
 * Static dependency scan: which content types and YAML sections use a given database.
 * Does not belong on DatabaseManager (cache/config) — this walks the content graph.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import { getAllConfigs, getDatabaseName, getLabel } from "./content-types";
import { listAllSinglePaths } from "./shared-layout-sync";
import { resolveSourceName } from "./query-options";
import { parseFormFieldSource } from "@shared/parseFormFieldSource";
import { escapeTemplateVars, unescapeObjectVars } from "@shared/templateVars";
import { loadAllFieldEditors } from "./component-registry";
import type { DatabaseManager } from "./database";
import { child } from "./logger";

const log = child({ module: "database-usage" });

export type DatabaseUsageQueryKind =
  | "direct_database"
  | "via_content_type"
  | "form_source"
  | "field_editor";

export interface DatabaseUsageContentType {
  name: string;
  label: string;
}

export interface DatabaseUsageQuery {
  kind: DatabaseUsageQueryKind;
  content_type: string;
  slug?: string;
  locale?: string;
  file?: string;
  section_type?: string;
  source_name?: string;
}

export interface DatabaseUsageReport {
  content_types: DatabaseUsageContentType[];
  queries: DatabaseUsageQuery[];
  notes?: string[];
}

function safeLoadYaml(filePath: string): Record<string, unknown> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const { escaped, map } = escapeTemplateVars(raw);
    const parsed = yaml.load(escaped);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return unescapeObjectVars(parsed as Record<string, unknown>, map) as Record<string, unknown>;
  } catch (err) {
    log.warn({ err, filePath }, "[DatabaseUsage] Failed to parse YAML");
    return null;
  }
}

function listYamlFilesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => (f.endsWith(".yml") || f.endsWith(".yaml")) && !f.startsWith("_") && f !== "versioning.yml")
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function relativeContentPath(contentRoot: string, absPath: string): string {
  return path.relative(contentRoot, absPath).split(path.sep).join("/");
}

function localeFromFilename(fileName: string): string | undefined {
  const stem = fileName.replace(/\.(yml|yaml)$/i, "");
  if (/^[a-z]{2}(?:-[a-z]+)?$/i.test(stem)) return stem;
  const single = /^single\.([a-z]{2}(?:-[a-z]+)?)$/i.exec(stem);
  if (single) return single[1];
  return undefined;
}

function contentTypeBackedByDb(
  contentType: string,
  dbName: string,
  contentRoot: string,
): boolean {
  return getDatabaseName(contentType, contentRoot) === dbName;
}

function sourceUsesDatabase(
  sourceName: string,
  dbName: string,
  contentRoot: string,
  db: DatabaseManager,
): { uses: boolean; kind: "direct_database" | "via_content_type"; resolved: string } | null {
  const resolved = resolveSourceName(sourceName, contentRoot, db);
  if (resolved.kind === "database" && resolved.name === dbName) {
    return { uses: true, kind: "direct_database", resolved: resolved.name };
  }
  if (resolved.kind === "contentType" && contentTypeBackedByDb(resolved.name, dbName, contentRoot)) {
    return { uses: true, kind: "via_content_type", resolved: resolved.name };
  }
  if (resolved.kind === "collision") {
    if (resolved.name === dbName || contentTypeBackedByDb(resolved.name, dbName, contentRoot)) {
      return {
        uses: true,
        kind: resolved.name === dbName ? "direct_database" : "via_content_type",
        resolved: resolved.name,
      };
    }
  }
  return null;
}

function collectLeadFormSources(data: unknown): Array<{ field: string; source: unknown }> {
  if (!data || typeof data !== "object") return [];
  const fields = (data as Record<string, unknown>).fields;
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return [];
  const out: Array<{ field: string; source: unknown }> = [];
  for (const [fieldName, fieldVal] of Object.entries(fields as Record<string, unknown>)) {
    if (!fieldVal || typeof fieldVal !== "object" || Array.isArray(fieldVal)) continue;
    const source = (fieldVal as Record<string, unknown>).source;
    if (source !== undefined && source !== null && source !== "") {
      out.push({ field: fieldName, source });
    }
  }
  return out;
}

function scanSectionsInFile(opts: {
  dbName: string;
  contentRoot: string;
  db: DatabaseManager;
  contentType: string;
  slug?: string;
  filePath: string;
  queries: DatabaseUsageQuery[];
}): void {
  const { dbName, contentRoot, db, contentType, slug, filePath, queries } = opts;
  const data = safeLoadYaml(filePath);
  if (!data) return;

  const sections = Array.isArray(data.sections) ? data.sections : [];
  const relFile = relativeContentPath(contentRoot, filePath);
  const locale = localeFromFilename(path.basename(filePath));

  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const sec = section as Record<string, unknown>;
    const sectionType = typeof sec.type === "string" ? sec.type : undefined;
    const dyn = sec.dynamic_entries as Record<string, unknown> | undefined;

    if (dyn && typeof dyn === "object") {
      const dynDb = typeof dyn.database === "string" ? dyn.database : undefined;
      const dynCt = typeof dyn.content_type === "string" ? dyn.content_type : undefined;

      if (dynDb === dbName) {
        queries.push({
          kind: "direct_database",
          content_type: contentType,
          slug,
          locale,
          file: relFile,
          section_type: sectionType,
          source_name: dynDb,
        });
      } else if (dynCt && contentTypeBackedByDb(dynCt, dbName, contentRoot)) {
        queries.push({
          kind: "via_content_type",
          content_type: contentType,
          slug,
          locale,
          file: relFile,
          section_type: sectionType,
          source_name: dynCt,
        });
      }
    }

    // Lead form (and similar) field sources under section.data or section root
    const sectionData = (sec.data && typeof sec.data === "object" ? sec.data : sec) as Record<
      string,
      unknown
    >;
    const formSources = collectLeadFormSources(sectionData);
    for (const { source } of formSources) {
      try {
        const parsed = parseFormFieldSource(
          source as string | { content_type?: string; database?: string; related_field?: string },
        );
        if (!parsed.content_type && !parsed.database) continue;
        const sourceName = parsed.content_type || parsed.database;
        if (!sourceName) continue;
        const hit = sourceUsesDatabase(sourceName, dbName, contentRoot, db);
        if (!hit) continue;
        queries.push({
          kind: "form_source",
          content_type: contentType,
          slug,
          locale,
          file: relFile,
          section_type: sectionType || "lead_form",
          source_name: hit.resolved,
        });
      } catch {
        /* ignore malformed source */
      }
    }

    // Inline editor type strings in section YAML
    const raw = JSON.stringify(sec);
    const pickerRe = new RegExp(
      `db-field-values-picker:${dbName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`,
      "g",
    );
    if (pickerRe.test(raw)) {
      queries.push({
        kind: "field_editor",
        content_type: contentType,
        slug,
        locale,
        file: relFile,
        section_type: sectionType,
        source_name: dbName,
      });
    }
  }
}

function collectContentYamlTargets(
  contentRoot: string,
  contentType: string,
  directory: string,
): Array<{ slug?: string; filePath: string }> {
  const typeDir = path.join(contentRoot, directory);
  const targets: Array<{ slug?: string; filePath: string }> = [];

  if (!fs.existsSync(typeDir)) return targets;

  // Shared singles at type root
  for (const { filePath } of listAllSinglePaths(typeDir)) {
    targets.push({ filePath });
  }
  for (const name of ["_common.template.yml", "_common.single.yml", "_common.yml"]) {
    const p = path.join(typeDir, name);
    if (fs.existsSync(p)) targets.push({ filePath: p });
  }

  // Entry folders
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(typeDir, { withFileTypes: true });
  } catch {
    return targets;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (slug === "single" || slug === "template") continue;
    const slugDir = path.join(typeDir, slug);
    for (const filePath of listYamlFilesInDir(slugDir)) {
      targets.push({ slug, filePath });
    }
    // Nested common under slug
    const common = path.join(slugDir, "_common.yml");
    if (fs.existsSync(common)) targets.push({ slug, filePath: common });
  }

  return targets;
}

/**
 * Build a usage report for a database slug.
 */
export function getDatabaseUsage(
  dbName: string,
  options: { contentRoot: string; db: DatabaseManager },
): DatabaseUsageReport {
  const { contentRoot, db } = options;
  const configs = getAllConfigs(contentRoot);

  const content_types: DatabaseUsageContentType[] = [];
  for (const [name, config] of Object.entries(configs)) {
    if (config.database?.slug === dbName) {
      content_types.push({ name, label: getLabel(name, contentRoot) });
    }
  }

  const queries: DatabaseUsageQuery[] = [];

  for (const [contentType, config] of Object.entries(configs)) {
    const targets = collectContentYamlTargets(contentRoot, contentType, config.directory);
    for (const { slug, filePath } of targets) {
      scanSectionsInFile({
        dbName,
        contentRoot,
        db,
        contentType,
        slug,
        filePath,
        queries,
      });
    }
  }

  // Component registry field-editors.ts bindings
  try {
    const editors = loadAllFieldEditors();
    const prefix = `db-field-values-picker:${dbName}:`;
    for (const [componentType, fields] of Object.entries(editors)) {
      for (const [fieldPath, editorType] of Object.entries(fields)) {
        if (typeof editorType === "string" && editorType.startsWith(prefix)) {
          queries.push({
            kind: "field_editor",
            content_type: componentType,
            section_type: componentType,
            source_name: dbName,
            file: `component-registry/${componentType} (field-editors: ${fieldPath})`,
          });
        }
      }
    }
  } catch (err) {
    log.warn({ err }, "[DatabaseUsage] Failed to load field editors");
  }

  const notes: string[] = [];
  if (dbName === "frequently_asked_questions") {
    notes.push(
      "Built-in FAQ editors (FaqItemsPicker, FaqEditor, RelatedFeaturesPicker) also hardcode this database in code; they are not listed as page rows above.",
    );
  }

  return {
    content_types,
    queries,
    ...(notes.length > 0 ? { notes } : {}),
  };
}
