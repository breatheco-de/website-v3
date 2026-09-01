import * as fs from "fs";
import { getDefaultContentFolder, getInheritComponentsFrom } from "./site-config";
import * as path from "path";
import * as yaml from "js-yaml";
import {

  escapeTemplateVars,
  unescapeObjectVars,
  escapeObjectVars,
  unescapeYamlDump,
} from "../shared/templateVars";
import {
  assertNoRegistryCollisions,
  listMergedComponentTypes,
  resolveComponentPath,
  type RegistryOrigin,
} from "../shared/registry-resolve";
import { resolveComponentBehaviors } from "@shared/component-behaviors";
import { child } from "./logger";
const log = child({ module: "component-registry" });


function safeYamlLoad(content: string): unknown {
  const { escaped, map } = escapeTemplateVars(content);
  const parsed = yaml.load(escaped);
  return unescapeObjectVars(parsed, map);
}

function safeYamlDump(obj: unknown, opts?: yaml.DumpOptions): string {
  const { escaped, map } = escapeObjectVars(obj);
  const dumped = yaml.dump(escaped, opts);
  return unescapeYamlDump(dumped, map);
}

function activeContentFolder(contentFolder?: string): string {
  return contentFolder || getDefaultContentFolder();
}

function inheritFor(contentFolder?: string): string | undefined {
  return getInheritComponentsFrom(activeContentFolder(contentFolder));
}

/** Absolute path to a component type dir (shared or site), or null if missing. */
function componentTypeDir(componentType: string, contentFolder?: string): string | null {
  try {
    const folder = activeContentFolder(contentFolder);
    const resolved = resolveComponentPath(
      componentType,
      folder,
      process.cwd(),
      inheritFor(folder),
    );
    return resolved?.componentDir ?? null;
  } catch (err) {
    log.error({ err }, `Registry collision resolving ${componentType}`);
    throw err;
  }
}

/** @deprecated Prefer resolveComponentPath; kept for callers that need a single site root. */
function siteRegistryPath(contentFolder?: string): string {
  return path.join(process.cwd(), activeContentFolder(contentFolder), "component-registry");
}

/**
 * Assert shared vs site type names do not overlap for the active/default site.
 * Call during server startup.
 */
export function assertComponentRegistryHealth(contentFolder?: string): void {
  const folder = activeContentFolder(contentFolder);
  assertNoRegistryCollisions(folder, process.cwd(), inheritFor(folder));
}

/**
 * Root of `schema.yml` for a component version.
 *
 * Optional `image_sizes`: keys are `"variantName.fieldOrArrayPath"` (first segment = section
 * `variant`, rest = dotted path under the section object). The path after the first dot must
 * match `fieldContext.fieldPath` or `fieldContext.arrayPath` from the variant TSX. Use `[]`
 * for array wildcards (e.g. `credibility.pills[].logos` → `pills.0.logos`, `pills.1.logos`, …).
 */
export interface ComponentSchema {
  name: string;
  version: string;
  component: string;
  file: string;
  description: string;
  when_to_use: string;
  section_defaults?: Record<string, unknown>;
  image_sizes?: Record<string, string>;
  /**
   * Advisory: this section type contributes schema.org JSON-LD during SSR.
   * Prefer `behaviors.schema_org`. Kept for legacy schema.yml files.
   * The executable mapping lives in `server/schema-components/index.ts`.
   */
  schema_org?: { handler: string; description?: string };
  /**
   * Behavioral patterns (ecommerce, schema_org, listing, conversion).
   * Discovery/docs/UI; executable wiring stays in runtime layers.
   */
  behaviors?: {
    ecommerce?: { role: "funnel" | "catalog"; events: string[]; notes?: string };
    schema_org?: { handler: string; notes?: string };
    listing?: { source: string; notes?: string };
    conversion?: { via: string; notes?: string };
  };
  props: Record<string, unknown>;
  variants?: Record<string, { description?: string; best_for?: string }>;
}

export interface ComponentExample {
  name: string;
  description: string;
  yaml: string;
  variant?: string;
  /** Disk mtime (ms) for screenshot cache invalidation */
  sourceMtime?: number;
  /** Disk size for screenshot cache invalidation */
  sourceSize?: number;
}

export interface ComponentVersion {
  version: string;
  schema: ComponentSchema;
  examples: ComponentExample[];
}

export interface ComponentInfo {
  type: string;
  versions: ComponentVersion[];
  latestVersion: string;
}

export interface PrimaryExampleMeta {
  name: string;
  version: string;
  sourceMtime: number;
  sourceSize: number;
}

export interface RegistryOverview {
  components: Array<{
    type: string;
    name: string;
    description: string;
    latestVersion: string;
    versions: string[];
    variants: string[];
    exampleCount: number;
    primaryExample?: PrimaryExampleMeta;
    /** Where the registry package lives */
    origin: RegistryOrigin;
    /** Declared behavior ids from schema.yml */
    behaviors?: string[];
  }>;
}

function parseVersion(version: string): number[] {
  return version.replace('v', '').split('.').map(Number);
}

function compareVersions(a: string, b: string): number {
  const aParts = parseVersion(a);
  const bParts = parseVersion(b);
  for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
    const aVal = aParts[i] || 0;
    const bVal = bParts[i] || 0;
    if (aVal !== bVal) return bVal - aVal;
  }
  return 0;
}

export function listComponents(contentFolder?: string): string[] {
  try {
    const folder = activeContentFolder(contentFolder);
    return listMergedComponentTypes(folder, process.cwd(), inheritFor(folder)).map(
      (t) => t.type,
    );
  } catch (error) {
    log.error({ err: error }, "Error listing components:");
    throw error;
  }
}

export function listComponentOrigins(
  contentFolder?: string,
): Record<string, RegistryOrigin> {
  const map: Record<string, RegistryOrigin> = {};
  const folder = activeContentFolder(contentFolder);
  for (const t of listMergedComponentTypes(folder, process.cwd(), inheritFor(folder))) {
    map[t.type] = t.origin;
  }
  return map;
}

export function listVersions(componentType: string, contentFolder?: string): string[] {
  try {
    const componentPath = componentTypeDir(componentType, contentFolder);
    if (!componentPath) {
      return [];
    }
    const versions = fs.readdirSync(componentPath)
      .filter(dir => {
        const versionPath = path.join(componentPath, dir);
        return fs.statSync(versionPath).isDirectory() && dir.startsWith('v');
      })
      .sort(compareVersions);
    return versions;
  } catch (error) {
    log.error({ err: error }, `Error listing versions for ${componentType}:`);
    return [];
  }
}

export function loadSchema(componentType: string, version: string, contentFolder?: string): ComponentSchema | null {
  try {
    const componentPath = componentTypeDir(componentType, contentFolder);
    if (!componentPath) return null;
    const schemaPath = path.join(componentPath, version, "schema.yml");
    if (!fs.existsSync(schemaPath)) {
      return null;
    }
    const content = fs.readFileSync(schemaPath, "utf8");
    return yaml.load(content) as ComponentSchema;
  } catch (error) {
    log.error({ err: error }, `Error loading schema for ${componentType}/${version}:`);
    return null;
  }
}

function normalizeRegistryFolderVersion(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const t = raw.trim();
  if (t.startsWith("v")) return t;
  return `v${t}`;
}

function resolveSchemaFolderForSection(componentType: string, sectionVersion: unknown, contentFolder?: string): string | null {
  const normalized = normalizeRegistryFolderVersion(sectionVersion);
  if (normalized) {
    const componentPath = componentTypeDir(componentType, contentFolder);
    if (componentPath) {
      const schemaPath = path.join(componentPath, normalized, "schema.yml");
      if (fs.existsSync(schemaPath)) return normalized;
    }
  }
  const versions = listVersions(componentType, contentFolder);
  return versions.length > 0 ? versions[0]! : null;
}

function getNestedFromRoot(root: unknown, dottedPath: string): unknown {
  if (!dottedPath || root === null || root === undefined || typeof root !== "object") return undefined;
  const parts = dottedPath.split(".");
  let cur: unknown = root;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Expands one `image_sizes` suffix that contains `[]` against section data.
 * Produces concrete paths (e.g. `pills.0.logos`) for `UniversalImage` / preload lookup.
 */
function expandImageSizesBracketPattern(
  section: Record<string, unknown>,
  suffixWithBrackets: string,
  sizes: string,
): Record<string, string> {
  const out: Record<string, string> = {};

  function walk(node: unknown, suffix: string, pathParts: string[]): void {
    const idx = suffix.indexOf("[]");
    if (idx === -1) {
      const tail = suffix;
      if (!tail) return;
      const fullPath = [...pathParts, ...tail.split(".").filter(Boolean)].join(".");
      const leafMatch =
        /(^|\.)(image_id|img|src|logo|image|thumb)$/.test(tail) || /\.[\w]+_(id|thumb)$/.test(`.${tail}`);
      if (leafMatch && pathParts.length >= 2) {
        out[pathParts.slice(0, -1).join(".")] = sizes;
      } else {
        out[fullPath] = sizes;
      }
      return;
    }
    const pathToArr = suffix.slice(0, idx);
    const after = suffix.slice(idx + 2).replace(/^\./, "");
    if (!pathToArr) return;
    const arr = getNestedFromRoot(node, pathToArr);
    if (!Array.isArray(arr)) return;
    const baseParts = [...pathParts, ...pathToArr.split(".")];
    for (let i = 0; i < arr.length; i++) {
      walk(arr[i], after, [...baseParts, String(i)]);
    }
  }

  walk(section, suffixWithBrackets, []);
  return out;
}

/** Resolves `image_sizes` for this section: literals + `[]` patterns expanded to concrete paths. */
export function resolveSectionImageSizes(section: Record<string, unknown>): Record<string, string> {
  const type = section.type as string | undefined;
  const variant = (section.variant as string | undefined) ?? "default";
  const out: Record<string, string> = {};
  if (!type) return out;

  const folder = resolveSchemaFolderForSection(type, section.version);
  if (!folder) return out;

  const schema = loadSchema(type, folder);
  const full = schema?.image_sizes;
  if (!full || typeof full !== "object") return out;

  const prefix = `${variant}.`;
  for (const [key, val] of Object.entries(full)) {
    if (typeof val !== "string" || !val.trim()) continue;
    if (!key.startsWith(prefix)) continue;
    const suffix = key.slice(prefix.length);
    if (!suffix) continue;
    if (suffix.includes("[]")) {
      Object.assign(out, expandImageSizesBracketPattern(section, suffix, val));
    } else {
      out[suffix] = val;
    }
  }
  return out;
}

/** Literals only (keys without `[]`); does not expand wildcards. */
export function getImageSizesForVariant(
  componentType: string,
  variant: string | undefined,
  sectionVersion?: unknown,
): Record<string, string> {
  if (!componentType || !variant) return {};
  const folder = resolveSchemaFolderForSection(componentType, sectionVersion);
  if (!folder) return {};
  const schema = loadSchema(componentType, folder);
  const full = schema?.image_sizes;
  if (!full || typeof full !== "object") return {};
  const prefix = `${variant}.`;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(full)) {
    if (typeof val !== "string" || !val.trim()) continue;
    if (!key.startsWith(prefix)) continue;
    const suffix = key.slice(prefix.length);
    if (suffix && !suffix.includes("[]")) out[suffix] = val;
  }
  return out;
}

export function getValueAtSectionPath(section: Record<string, unknown>, fieldPath: string): unknown {
  if (!fieldPath) return undefined;
  const parts = fieldPath.split(".");
  let cur: unknown = section;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function hasImageRefShape(o: Record<string, unknown>): boolean {
  return (
    typeof o.id === "string" &&
    (typeof o.alt === "string" ||
      typeof o.preset === "string" ||
      typeof o.src === "string")
  );
}

const IMAGE_ID_KEY_FOR_SIZES = /(?:^|_)image_id$/;

function collectRegistryImageIdsWithSizes(value: unknown, sizes: string, into: Map<string, string>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRegistryImageIdsWithSizes(item, sizes, into);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  if (hasImageRefShape(obj)) into.set(obj.id as string, sizes);
  if (typeof obj.image === "object" && obj.image !== null) {
    const img = obj.image as Record<string, unknown>;
    if (typeof img.id === "string") into.set(img.id, sizes);
  }
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string" && IMAGE_ID_KEY_FOR_SIZES.test(k)) into.set(v, sizes);
    else if (v && typeof v === "object") collectRegistryImageIdsWithSizes(v, sizes, into);
  }
}

export function buildImageIdToSchemaSizesMap(section: Record<string, unknown>): Map<string, string> {
  const into = new Map<string, string>();
  const type = section.type as string | undefined;
  const variant = section.variant as string | undefined;
  if (!type || !variant) return into;

  const pathToSizes = resolveSectionImageSizes(section);
  for (const [fieldPath, sizesStr] of Object.entries(pathToSizes)) {
    const node = getValueAtSectionPath(section, fieldPath);
    collectRegistryImageIdsWithSizes(node, sizesStr, into);
  }
  return into;
}

export function applyComponentImageSizes(sections: unknown[]): void {
  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const s = section as Record<string, unknown>;
    const type = s.type as string | undefined;
    if (!type) {
      s._imageSizes = {};
      continue;
    }
    s._imageSizes = resolveSectionImageSizes(s);
  }
}

function extractVariantFromYaml(yamlContent: string): string | undefined {
  try {
    const { escaped } = escapeTemplateVars(yamlContent);
    const parsed = yaml.load(escaped);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.variant) {
      return parsed[0].variant as string;
    }
    if (parsed && typeof parsed === 'object' && 'variant' in parsed) {
      return (parsed as { variant?: string }).variant;
    }
  } catch {
    // Ignore parse errors
  }
  return undefined;
}

export function loadExamples(componentType: string, version: string): ComponentExample[] {
  try {
    const examplesPath = path.join(componentTypeDir(componentType) || "", version, "examples");
    if (!fs.existsSync(examplesPath)) {
      return [];
    }
    const exampleFiles = fs.readdirSync(examplesPath)
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));
    
    return exampleFiles.map(file => {
      const filePath = path.join(examplesPath, file);
      const stat = fs.statSync(filePath);
      const content = fs.readFileSync(filePath, "utf8");
      const { escaped } = escapeTemplateVars(content);
      const data = yaml.load(escaped) as { name?: string; description?: string; yaml?: string; variant?: string };
      
      const yamlContent = data.yaml || content;
      const inferredVariant = extractVariantFromYaml(yamlContent);
      
      return {
        name: data.name || file.replace(/\.(yml|yaml)$/, ''),
        description: data.description || '',
        yaml: yamlContent,
        variant: inferredVariant || data.variant,
        sourceMtime: Math.floor(stat.mtimeMs),
        sourceSize: stat.size,
      };
    });
  } catch (error) {
    log.error({ err: error }, `Error loading examples for ${componentType}/${version}:`);
    return [];
  }
}

export function getComponentInfo(componentType: string): ComponentInfo | null {
  const versions = listVersions(componentType);
  if (versions.length === 0) {
    return null;
  }
  
  const componentVersions: ComponentVersion[] = versions.map(version => {
    const schema = loadSchema(componentType, version);
    const examples = loadExamples(componentType, version);
    return {
      version,
      schema: schema!,
      examples,
    };
  }).filter(v => v.schema !== null);
  
  return {
    type: componentType,
    versions: componentVersions,
    latestVersion: versions[0],
  };
}

/**
 * First example file (sorted by filename) for a component version, with disk stats
 * for cheap screenshot cache invalidation.
 */
export function getPrimaryExampleMeta(
  componentType: string,
  version: string,
  contentFolder?: string,
): PrimaryExampleMeta | undefined {
  try {
    const examplesPath = path.join(componentTypeDir(componentType, contentFolder) || "", version, "examples");
    if (!fs.existsSync(examplesPath)) return undefined;

    const exampleFiles = fs
      .readdirSync(examplesPath)
      .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))
      .sort();

    if (exampleFiles.length === 0) return undefined;

    const file = exampleFiles[0]!;
    const filePath = path.join(examplesPath, file);
    const stat = fs.statSync(filePath);
    const content = fs.readFileSync(filePath, "utf8");
    const { escaped } = escapeTemplateVars(content);
    const data = yaml.load(escaped) as { name?: string } | null;
    const name =
      (data && typeof data === "object" && typeof data.name === "string" && data.name) ||
      file.replace(/\.(yml|yaml)$/, "");

    return {
      name,
      version,
      sourceMtime: Math.floor(stat.mtimeMs),
      sourceSize: stat.size,
    };
  } catch (error) {
    log.error({ err: error }, `Error reading primary example for ${componentType}/${version}:`);
    return undefined;
  }
}

export function getRegistryOverview(contentFolder?: string): RegistryOverview {
  const folder = activeContentFolder(contentFolder);
  const merged = listMergedComponentTypes(folder, process.cwd(), inheritFor(folder));

  return {
    components: merged.map(({ type, origin }) => {
      const versions = listVersions(type, folder);
      const latestVersion = versions[0] || "v1.0";
      const schema = loadSchema(type, latestVersion, folder);
      const variants = schema?.variants ? Object.keys(schema.variants) : [];
      const primaryExample = getPrimaryExampleMeta(type, latestVersion, folder);
      const examplesPath = path.join(componentTypeDir(type, folder) || "", latestVersion, "examples");
      let exampleCount = 0;
      if (fs.existsSync(examplesPath)) {
        exampleCount = fs
          .readdirSync(examplesPath)
          .filter((file) => file.endsWith(".yml") || file.endsWith(".yaml")).length;
      }

      const resolvedBehaviors = resolveComponentBehaviors(
        (schema ?? {}) as unknown as Record<string, unknown>,
      );
      const behaviorIds = (["ecommerce", "schema_org", "listing", "conversion"] as const).filter(
        (id) => Boolean(resolvedBehaviors[id]),
      );

      return {
        type,
        name: schema?.name || type,
        description: schema?.description || "",
        latestVersion,
        versions,
        variants,
        exampleCount,
        primaryExample,
        origin,
        behaviors: behaviorIds,
      };
    }),
  };
}

export function createNewVersion(componentType: string, baseVersion: string): { success: boolean; newVersion: string; error?: string } {
  try {
    const versions = listVersions(componentType);
    if (!versions.includes(baseVersion)) {
      return { success: false, newVersion: '', error: `Base version ${baseVersion} not found` };
    }
    
    const baseParts = parseVersion(baseVersion);
    const newVersionStr = `v${baseParts[0]}.${(baseParts[1] || 0) + 1}`;
    
    const basePath = path.join(componentTypeDir(componentType) || "", baseVersion);
    const newPath = path.join(componentTypeDir(componentType) || "", newVersionStr);
    
    if (fs.existsSync(newPath)) {
      return { success: false, newVersion: '', error: `Version ${newVersionStr} already exists` };
    }
    
    fs.mkdirSync(newPath, { recursive: true });
    fs.mkdirSync(path.join(newPath, "examples"), { recursive: true });
    
    const schemaPath = path.join(basePath, "schema.yml");
    if (fs.existsSync(schemaPath)) {
      let schemaContent = fs.readFileSync(schemaPath, "utf8");
      schemaContent = schemaContent.replace(/version:\s*["']?[\d.]+["']?/, `version: "${newVersionStr.replace('v', '')}"`);
      fs.writeFileSync(path.join(newPath, "schema.yml"), schemaContent);
    }
    
    const examplesPath = path.join(basePath, "examples");
    if (fs.existsSync(examplesPath)) {
      const examples = fs.readdirSync(examplesPath);
      for (const example of examples) {
        const srcPath = path.join(examplesPath, example);
        const destPath = path.join(newPath, "examples", example);
        if (fs.statSync(srcPath).isFile()) {
          fs.copyFileSync(srcPath, destPath);
        }
      }
    }
    
    return { success: true, newVersion: newVersionStr };
  } catch (error) {
    log.error({ err: error }, `Error creating new version for ${componentType}:`);
    return { success: false, newVersion: '', error: String(error) };
  }
}

export function getExampleFilePath(componentType: string, version: string): string {
  return path.join(getDefaultContentFolder(), "component-registry", componentType, version, "examples");
}

export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "link-picker" | "video-picker";

export interface AllFieldEditors {
  [componentType: string]: Record<string, EditorType>;
}

/**
 * Load all field editors from component registry for a site
 * (resolved through inherit_components_from when set).
 */
export function loadAllFieldEditors(contentFolder?: string): AllFieldEditors {
  const result: AllFieldEditors = {};
  const folder = activeContentFolder(contentFolder);

  try {
    const components = listComponents(folder);

    for (const componentType of components) {
      // Skip common folder
      if (componentType === "common") continue;

      const versions = listVersions(componentType, folder);
      if (versions.length === 0) continue;

      // Use latest version
      const latestVersion = versions[0];
      const fieldEditorsPath = path.join(
        componentTypeDir(componentType, folder) || "",
        latestVersion,
        "field-editors.ts",
      );

      if (fs.existsSync(fieldEditorsPath)) {
        try {
          const content = fs.readFileSync(fieldEditorsPath, "utf8");

          // Parse the TypeScript file to extract fieldEditors object
          // Look for: export const fieldEditors: Record<string, EditorType> = { ... };
          const match = content.match(/export\s+const\s+fieldEditors\s*[^=]*=\s*(\{[\s\S]*?\});/);

          if (match) {
            // Simple parser for the object literal
            const objStr = match[1];
            const entries: Record<string, EditorType> = {};

            // Match patterns like: "features[].icon": "icon-picker",
            // Also allow unquoted identifier keys: item_overrides: "faq-section-editor",
            const entryRegex = /(?:"([^"]+)"|([A-Za-z_][\w.[\]]*)):\s*"([^"]+)"/g;
            let entryMatch;

            while ((entryMatch = entryRegex.exec(objStr)) !== null) {
              const fieldPath = entryMatch[1] || entryMatch[2];
              const editorType = entryMatch[3];
              // Parse base type (e.g., "color-picker:background" -> "color-picker")
              const baseType = editorType.split(":")[0];
              if (["icon-picker", "color-picker", "image-picker", "image-with-style-picker", "link-picker", "rich-text-editor", "markdown", "boolean-toggle", "variant-picker", "video-picker", "cta-picker", "cta-tracking", "string-picker", "font-size-picker", "related-features-picker", "faq-visibility-editor", "faq-section-editor", "list-cards-section-editor", "db-field-values-picker", "form-settings"].includes(baseType)) {
                entries[fieldPath] = editorType as EditorType;
              }
            }

            if (Object.keys(entries).length > 0) {
              result[componentType] = entries;
            }
          }
        } catch (parseError) {
          log.error({ err: parseError }, `Error parsing field-editors for ${componentType}:`);
        }
      }
    }
  } catch (error) {
    log.error({ err: error }, "Error loading field editors:");
  }

  return result;
}

export function saveExample(
  componentType: string, 
  version: string, 
  exampleName: string, 
  yamlContent: string
): { success: boolean; filePath?: string; error?: string } {
  try {
    const examplesPath = path.join(componentTypeDir(componentType) || "", version, "examples");
    
    if (!fs.existsSync(examplesPath)) {
      return { success: false, error: `Examples path not found for ${componentType}/${version}` };
    }
    
    // Find the example file by name
    const exampleFiles = fs.readdirSync(examplesPath)
      .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));
    
    let targetFile: string | null = null;
    
    for (const file of exampleFiles) {
      const filePath = path.join(examplesPath, file);
      const content = fs.readFileSync(filePath, "utf8");
      const data = safeYamlLoad(content) as { name?: string };

      if (data.name === exampleName) {
        targetFile = file;
        break;
      }
    }
    
    if (!targetFile) {
      return { success: false, error: `Example "${exampleName}" not found` };
    }
    
    const filePath = path.join(examplesPath, targetFile);
    const existingContent = fs.readFileSync(filePath, "utf8");
    const existingData = safeYamlLoad(existingContent) as { name?: string; description?: string; variant?: string };
    
    // Strip section_id before saving — it's page-specific and meaningless in a registry example
    let cleanYamlContent = yamlContent;
    try {
      const parsed = safeYamlLoad(yamlContent);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: Record<string, unknown>) => { delete item.section_id; });
        cleanYamlContent = safeYamlDump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: false });
      } else if (parsed && typeof parsed === 'object') {
        delete (parsed as Record<string, unknown>).section_id;
        cleanYamlContent = safeYamlDump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: false });
      }
    } catch {
      // If parsing fails, keep the original content
    }

    // Preserve the example metadata and update the yaml content
    const newContent = {
      name: existingData.name || exampleName,
      description: existingData.description || '',
      variant: existingData.variant,
      yaml: cleanYamlContent,
    };
    
    // Remove undefined variant
    if (!newContent.variant) {
      delete (newContent as { variant?: string }).variant;
    }
    
    const yamlOutput = safeYamlDump(newContent, { 
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
    });
    
    fs.writeFileSync(filePath, yamlOutput);
    
    return { success: true, filePath };
  } catch (error) {
    log.error({ err: error }, `Error saving example for ${componentType}/${version}:`);
    return { success: false, error: String(error) };
  }
}

function normalizeVariantName(v: string): string {
  return v.toLowerCase().replace(/[-_\s]/g, "");
}

function toPascalCase(str: string): string {
  return str
    .replace(/[-_](.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (c: string) => c.toUpperCase());
}

function resolveVariantTsxPath(componentType: string, variantName: string): string {
  const typePascal = toPascalCase(componentType);
  const variantPascal = toPascalCase(variantName);
  const fileName = `${typePascal}${variantPascal}.tsx`;
  return path.join(process.cwd(), "client", "src", "components", componentType, "variants", fileName);
}

export function getVariantByExample(
  componentType: string,
  version: string,
  exampleName: string
): string | null {
  // loadExamples already applies escapeTemplateVars + extractVariantFromYaml
  const examples = loadExamples(componentType, version);
  const found = examples.find((e) => e.name === exampleName);
  // If the example exists in the requested version, use that result only.
  // Don't fall back to other versions — this is a destructive action and
  // picking a different version's variant could delete the wrong thing.
  if (found) return found.variant ?? "default";

  // Example not found in specified version — search other versions
  for (const v of listVersions(componentType)) {
    if (v === version) continue;
    const vFound = loadExamples(componentType, v).find((e) => e.name === exampleName);
    if (vFound?.variant) return vFound.variant;
  }
  return null;
}

export function getVariantExamples(
  componentType: string,
  variantName: string
): Array<{ version: string; name: string }> {
  const result: Array<{ version: string; name: string }> = [];
  const versions = listVersions(componentType);
  const normalizedTarget = normalizeVariantName(variantName);

  for (const v of versions) {
    const examples = loadExamples(componentType, v);
    for (const ex of examples) {
      const exVariant = ex.variant || "default";
      if (normalizeVariantName(exVariant) === normalizedTarget) {
        result.push({ version: v, name: ex.name });
      }
    }
  }
  return result;
}

export function deleteExample(
  componentType: string,
  version: string,
  exampleName: string
): { success: boolean; filePath?: string; error?: string } {
  try {
    const examplesPath = path.join(componentTypeDir(componentType) || "", version, "examples");
    if (!fs.existsSync(examplesPath)) {
      return { success: false, error: `Examples path not found for ${componentType}/${version}` };
    }

    const exampleFiles = fs.readdirSync(examplesPath).filter(
      (file) => file.endsWith(".yml") || file.endsWith(".yaml")
    );

    let targetFile: string | null = null;
    for (const file of exampleFiles) {
      const filePath = path.join(examplesPath, file);
      const content = fs.readFileSync(filePath, "utf8");
      const data = safeYamlLoad(content) as { name?: string };
      if (data.name === exampleName) {
        targetFile = file;
        break;
      }
    }

    if (!targetFile) {
      return { success: false, error: `Example "${exampleName}" not found` };
    }

    const deletedFilePath = path.join(examplesPath, targetFile);
    fs.unlinkSync(deletedFilePath);
    return { success: true, filePath: deletedFilePath };
  } catch (error) {
    log.error({ err: error }, `Error deleting example ${exampleName} for ${componentType}/${version}:`);
    return { success: false, error: String(error) };
  }
}

function deleteVariantExamples(
  componentType: string,
  variantName: string
): { deleted: string[]; deletedPaths: string[]; errors: string[] } {
  const deleted: string[] = [];
  const deletedPaths: string[] = [];
  const errors: string[] = [];
  const versions = listVersions(componentType);
  const normalizedTarget = normalizeVariantName(variantName);

  for (const v of versions) {
    const examplesPath = path.join(componentTypeDir(componentType) || "", v, "examples");
    if (!fs.existsSync(examplesPath)) continue;

    const exampleFiles = fs.readdirSync(examplesPath).filter(
      (file) => file.endsWith(".yml") || file.endsWith(".yaml")
    );

    for (const file of exampleFiles) {
      const filePath = path.join(examplesPath, file);
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const data = safeYamlLoad(content) as { name?: string; variant?: string; yaml?: string };
        const exVariant = data.variant || extractVariantFromYaml(data.yaml || "") || "default";
        if (normalizeVariantName(exVariant) === normalizedTarget) {
          fs.unlinkSync(filePath);
          deleted.push(data.name || file);
          deletedPaths.push(filePath);
        }
      } catch (e) {
        errors.push(`${v}/${file}: ${String(e)}`);
      }
    }
  }
  return { deleted, deletedPaths, errors };
}

export function createExample(
  componentType: string,
  version: string,
  yamlContent: string,
  sectionId?: string,
  options?: { displayName?: string; description?: string }
): { success: boolean; filename?: string; exampleName?: string; filePath?: string; error?: string } {
  try {
    const examplesPath = path.join(componentTypeDir(componentType) || "", version, "examples");
    if (!fs.existsSync(examplesPath)) {
      fs.mkdirSync(examplesPath, { recursive: true });
    }

    const trimmedName = options?.displayName?.trim();
    let base: string;
    if (trimmedName) {
      base = trimmedName
        .replace(/[^a-z0-9_-]+/gi, "_")
        .replace(/^_+|_+$/g, "")
        .toLowerCase();
      if (!base) {
        base = `${componentType}_${Date.now()}`;
      }
    } else if (sectionId) {
      base = sectionId.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
    } else {
      base = `${componentType}_${Date.now()}`;
    }

    let filename = `${base}.yml`;
    let counter = 1;
    while (fs.existsSync(path.join(examplesPath, filename))) {
      filename = `${base}_${counter++}.yml`;
    }

    const yamlTitle = trimmedName || filename.replace(/\.ya?ml$/, "").replace(/_/g, " ");
    // Strip section_id from the YAML content before saving — it's page-specific
    // and has no meaning in a reusable registry example
    let cleanYamlContent = yamlContent;
    try {
      const parsed = safeYamlLoad(yamlContent);
      if (Array.isArray(parsed)) {
        parsed.forEach((item: Record<string, unknown>) => { delete item.section_id; });
        cleanYamlContent = safeYamlDump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: false });
      } else if (parsed && typeof parsed === 'object') {
        delete (parsed as Record<string, unknown>).section_id;
        cleanYamlContent = safeYamlDump(parsed, { lineWidth: -1, quotingType: '"', forceQuotes: false });
      }
    } catch {
      // If parsing fails, keep the original content
    }

    const payload: Record<string, unknown> = {
      name: yamlTitle,
      yaml: cleanYamlContent,
    };
    const trimmedDesc = options?.description?.trim();
    if (trimmedDesc) {
      payload.description = trimmedDesc;
    }

    const fileContent = safeYamlDump(payload, {
      lineWidth: -1,
      quotingType: '"',
      forceQuotes: false,
    });

    const fullFilePath = path.join(examplesPath, filename);
    fs.writeFileSync(fullFilePath, fileContent);
    return { success: true, filename, exampleName: yamlTitle, filePath: fullFilePath };
  } catch (error) {
    log.error({ err: error }, `Error creating example for ${componentType}/${version}:`);
    return { success: false, error: String(error) };
  }
}

export function deleteVariant(
  componentType: string,
  variantName: string
): { success: boolean; deletedExamples: string[]; deletedExamplePaths: string[]; tsxPath: string; error?: string } {
  try {
    const tsxPath = resolveVariantTsxPath(componentType, variantName);
    if (fs.existsSync(tsxPath)) {
      fs.unlinkSync(tsxPath);
    }
    const { deleted, deletedPaths } = deleteVariantExamples(componentType, variantName);

    // If no variant TSX files remain, clean up the orphaned directories
    const variantsDir = path.join(process.cwd(), "client", "src", "components", componentType, "variants");
    if (fs.existsSync(variantsDir)) {
      const remaining = fs.readdirSync(variantsDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));
      if (remaining.length === 0) {
        fs.rmSync(variantsDir, { recursive: true, force: true });
        // Also remove the parent component folder if it's now empty
        const componentDir = path.join(process.cwd(), "client", "src", "components", componentType);
        if (fs.existsSync(componentDir) && fs.readdirSync(componentDir).length === 0) {
          fs.rmSync(componentDir, { recursive: true, force: true });
        }
      }
    }

    return { success: true, deletedExamples: deleted, deletedExamplePaths: deletedPaths, tsxPath };
  } catch (error) {
    log.error({ err: error }, `Error deleting variant ${variantName} for ${componentType}:`);
    return { success: false, deletedExamples: [], deletedExamplePaths: [], tsxPath: resolveVariantTsxPath(componentType, variantName), error: String(error) };
  }
}

let _sectionDefaultsCache: Record<string, Record<string, unknown>> | null = null;

export function applyComponentSectionDefaults(sections: unknown[]): void {
  const allDefaults = getComponentSectionDefaults();
  if (Object.keys(allDefaults).length === 0) return;

  for (const section of sections) {
    if (!section || typeof section !== "object") continue;
    const s = section as Record<string, unknown>;
    const sectionType = s.type as string;
    if (!sectionType || !allDefaults[sectionType]) continue;
    const defaults = allDefaults[sectionType];
    for (const [key, value] of Object.entries(defaults)) {
      if (!(key in s)) {
        s[key] = value;
      }
    }
  }
}

export function getComponentSectionDefaults(): Record<string, Record<string, unknown>> {
  if (_sectionDefaultsCache) return _sectionDefaultsCache;

  const defaults: Record<string, Record<string, unknown>> = {};
  try {
    const components = listComponents();
    for (const componentType of components) {
      if (componentType === "_common") continue;
      const versions = listVersions(componentType);
      if (versions.length === 0) continue;
      const schema = loadSchema(componentType, versions[0]);
      if (schema?.section_defaults && typeof schema.section_defaults === "object") {
        defaults[componentType] = schema.section_defaults;
      }
    }
  } catch (error) {
    log.error({ err: error }, "Error loading component section defaults:");
  }

  _sectionDefaultsCache = defaults;
  return defaults;
}
