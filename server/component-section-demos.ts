/**
 * Ephemeral single-section demos for MCP → human preview links.
 * Files live under `.cache/component-section-demos/{hash}.yml` and are wiped on deploy.
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  listVersions,
  loadSchema,
  type ComponentSchema,
} from "./component-registry";

export const DEMO_HASH_RE = /^[a-f0-9]{32}$/;
export const MAX_DEMO_YAML_BYTES = 100 * 1024;

/** Section keys that are not schema.yml `props` (layout / identity). */
const SECTION_META_ROOT_KEYS = new Set([
  "type",
  "version",
  "variant",
  "section_id",
  "id",
  "showOnLocations",
  "showOnRegions",
  "marginY",
  "paddingY",
  "marginX",
  "paddingX",
]);

export type DemoRecord = {
  created_at: string;
  component_type: string;
  version: string;
  section: Record<string, unknown>;
};

export type DemoValidationError = {
  message: string;
  property_path?: string;
  details?: string[];
};

export function demosDir(cwd = process.cwd()): string {
  return path.join(cwd, ".cache", "component-section-demos");
}

export function ensureDemosDir(cwd = process.cwd()): string {
  const dir = demosDir(cwd);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function demoFilePath(hash: string, cwd = process.cwd()): string {
  if (!DEMO_HASH_RE.test(hash)) {
    throw new Error("Invalid demo hash");
  }
  return path.join(demosDir(cwd), `${hash}.yml`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Accept a single section object, a one-element array, or `{ sections: [one] }`.
 */
export function normalizeToSingleSection(parsed: unknown): {
  section?: Record<string, unknown>;
  error?: DemoValidationError;
} {
  if (Array.isArray(parsed)) {
    if (parsed.length !== 1) {
      return {
        error: {
          message: `Expected exactly one section; got array of length ${parsed.length}`,
        },
      };
    }
    if (!isPlainObject(parsed[0])) {
      return { error: { message: "Section array item must be an object" } };
    }
    return { section: parsed[0] };
  }

  if (!isPlainObject(parsed)) {
    return { error: { message: "YAML must parse to an object or a one-element array" } };
  }

  if (Array.isArray(parsed.sections)) {
    if (parsed.sections.length !== 1) {
      return {
        error: {
          message: `Expected sections array of length 1; got ${parsed.sections.length}`,
          property_path: "sections",
        },
      };
    }
    if (!isPlainObject(parsed.sections[0])) {
      return {
        error: {
          message: "sections[0] must be an object",
          property_path: "sections[0]",
        },
      };
    }
    return { section: parsed.sections[0] };
  }

  return { section: parsed };
}

function collectRequiredPropPaths(
  props: Record<string, unknown> | undefined,
  prefix = "",
): string[] {
  if (!props || typeof props !== "object") return [];
  const required: string[] = [];
  for (const [key, def] of Object.entries(props)) {
    if (!def || typeof def !== "object" || Array.isArray(def)) continue;
    const propDef = def as Record<string, unknown>;
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (propDef.required === true) {
      required.push(pathKey);
    }
    if (propDef.type === "object" && isPlainObject(propDef.properties)) {
      required.push(
        ...collectRequiredPropPaths(propDef.properties as Record<string, unknown>, pathKey),
      );
    }
  }
  return required;
}

function getAtPath(obj: Record<string, unknown>, dotted: string): unknown {
  const parts = dotted.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

export function validateSectionAgainstSchema(
  section: Record<string, unknown>,
  componentType: string,
  version: string | undefined,
  contentFolder?: string,
):
  | { ok: true; version: string; section: Record<string, unknown> }
  | { ok: false; error: DemoValidationError } {
  const typeVal = section.type;
  if (typeof typeVal !== "string" || !typeVal.trim()) {
    return {
      ok: false,
      error: { message: "Section must include a string type", property_path: "type" },
    };
  }
  if (typeVal !== componentType) {
    return {
      ok: false,
      error: {
        message: `section.type "${typeVal}" does not match componentType "${componentType}"`,
        property_path: "type",
      },
    };
  }

  const versions = listVersions(componentType, contentFolder);
  if (versions.length === 0) {
    return {
      ok: false,
      error: { message: `Component '${componentType}' not found in registry` },
    };
  }

  const requested =
    typeof version === "string" && version.trim()
      ? version.trim()
      : typeof section.version === "string"
        ? section.version.trim()
        : versions[0]!;

  const normalizedVersion = requested.startsWith("v") ? requested : `v${requested}`;
  const resolvedVersion = versions.includes(normalizedVersion)
    ? normalizedVersion
    : versions.includes(requested)
      ? requested
      : null;

  if (!resolvedVersion) {
    return {
      ok: false,
      error: {
        message: `Version '${requested}' not found for '${componentType}' (have: ${versions.join(", ")})`,
        property_path: "version",
      },
    };
  }

  const schema: ComponentSchema | null = loadSchema(
    componentType,
    resolvedVersion,
    contentFolder,
  );
  if (!schema) {
    return {
      ok: false,
      error: {
        message: `Schema not found for ${componentType}/${resolvedVersion}`,
      },
    };
  }

  const requiredPaths = collectRequiredPropPaths(
    schema.props as Record<string, unknown> | undefined,
  );
  const missing: string[] = [];
  for (const propPath of requiredPaths) {
    const root = propPath.split(".")[0]!;
    if (SECTION_META_ROOT_KEYS.has(root)) continue;
    const value = getAtPath(section, propPath);
    if (value === undefined || value === null || value === "") {
      missing.push(propPath);
    }
  }

  if (missing.length > 0) {
    return {
      ok: false,
      error: {
        message: `Missing required field(s): ${missing.join(", ")}`,
        property_path: missing[0],
        details: missing.map((p) => `Missing required property: ${p}`),
      },
    };
  }

  const sectionOut: Record<string, unknown> = {
    ...section,
    type: componentType,
    version: resolvedVersion,
  };

  return { ok: true, version: resolvedVersion, section: sectionOut };
}

export function parseAndValidateDemoYaml(opts: {
  yamlText: string;
  componentType: string;
  version?: string;
  contentFolder?: string;
}):
  | { ok: true; version: string; section: Record<string, unknown> }
  | { ok: false; error: DemoValidationError } {
  const { yamlText, componentType, version, contentFolder } = opts;

  if (Buffer.byteLength(yamlText, "utf8") > MAX_DEMO_YAML_BYTES) {
    return {
      ok: false,
      error: {
        message: `YAML exceeds ${MAX_DEMO_YAML_BYTES} bytes`,
      },
    };
  }

  let parsed: unknown;
  try {
    parsed = yaml.load(yamlText);
  } catch (e) {
    return {
      ok: false,
      error: {
        message: `Invalid YAML: ${(e as Error).message}`,
      },
    };
  }

  const normalized = normalizeToSingleSection(parsed);
  if (normalized.error || !normalized.section) {
    return { ok: false, error: normalized.error! };
  }

  return validateSectionAgainstSchema(
    normalized.section,
    componentType,
    version,
    contentFolder,
  );
}

export function buildPreviewUrl(hash: string): string {
  const base =
    (process.env.SITE_URL || "").replace(/\/$/, "") ||
    (process.env.NODE_ENV === "production"
      ? ""
      : `http://localhost:${process.env.PORT || "5000"}`);
  if (!base) {
    throw new Error("SITE_URL is required to build demo preview URLs in production");
  }
  return `${base}/private/demo/${hash}`;
}

export function createDemo(opts: {
  componentType: string;
  version: string;
  section: Record<string, unknown>;
  cwd?: string;
}): { hash: string; previewUrl: string; relativePath: string } {
  const cwd = opts.cwd ?? process.cwd();
  ensureDemosDir(cwd);
  const hash = crypto.randomBytes(16).toString("hex");
  const record: DemoRecord = {
    created_at: new Date().toISOString(),
    component_type: opts.componentType,
    version: opts.version,
    section: opts.section,
  };
  const filePath = demoFilePath(hash, cwd);
  const body = yaml.dump(record, { lineWidth: 120, noRefs: true });
  if (Buffer.byteLength(body, "utf8") > MAX_DEMO_YAML_BYTES) {
    throw new Error(`Serialized demo exceeds ${MAX_DEMO_YAML_BYTES} bytes`);
  }
  fs.writeFileSync(filePath, body, "utf8");
  const relativePath = path.relative(cwd, filePath).split(path.sep).join("/");
  return {
    hash,
    previewUrl: buildPreviewUrl(hash),
    relativePath,
  };
}

export function readDemo(hash: string, cwd = process.cwd()): DemoRecord | null {
  if (!DEMO_HASH_RE.test(hash)) return null;
  const filePath = demoFilePath(hash, cwd);
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = yaml.load(raw);
    if (!isPlainObject(parsed) || !isPlainObject(parsed.section)) return null;
    if (typeof parsed.component_type !== "string") return null;
    return {
      created_at: typeof parsed.created_at === "string" ? parsed.created_at : "",
      component_type: parsed.component_type,
      version: typeof parsed.version === "string" ? parsed.version : "",
      section: parsed.section,
    };
  } catch {
    return null;
  }
}

/** Raw on-disk YAML for a demo (exact bytes written at create time). */
export function readDemoYamlText(hash: string, cwd = process.cwd()): string | null {
  if (!DEMO_HASH_RE.test(hash)) return null;
  const filePath = demoFilePath(hash, cwd);
  if (!fs.existsSync(filePath)) return null;
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
