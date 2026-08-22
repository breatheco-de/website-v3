/**
 * Scoped validation for micro-saves vs full publish gate.
 */

export type ValidationIntent = "publish" | "micro";

/** _common.yml operational fields — micro-save skips live SEO gate when only these change. */
export const COMMON_OPERATIONAL_PATHS = new Set(["locations", "programs"]);

export const META_VISIBILITY_PATHS = new Set([
  "meta.robots",
  "meta.priority",
  "meta.change_frequency",
]);

export const META_OPTIONAL_PATHS = new Set(["meta.canonical_url", "meta.og_image"]);

export const META_SNIPPET_PATHS = new Set(["meta.page_title", "meta.description"]);

export type MetaSnippetKey = "page_title" | "description";

export type MicroValidationFlags = {
  /** Run every validator (publish). */
  runFull: boolean;
  /** null = all meta keys; [] = skip meta validation. */
  metaKeys: MetaSnippetKey[] | null;
  /** null = all required editor keys; [] = skip body validation. */
  bodyKeys: string[] | null;
  runEmptyDetached: boolean;
  runSchemaOrgCompanion: boolean;
  runFormSources: boolean;
  /** Publish/promote: bidirectional SEO cluster in-body links. */
  runClusterLinks: boolean;
};

function normalizePaths(paths: readonly string[]): string[] {
  return paths.map((p) => p.trim()).filter(Boolean);
}

/** True when micro-save touches only common operational paths (locations, programs). */
export function isCommonOperationalOnly(touchedPaths: readonly string[]): boolean {
  const paths = normalizePaths(touchedPaths);
  return paths.length > 0 && paths.every((p) => COMMON_OPERATIONAL_PATHS.has(p));
}

/** Map meta.page_title → page_title for validateRequiredMetaKeys. */
export function metaSnippetKeysFromPaths(touchedPaths: readonly string[]): MetaSnippetKey[] {
  const keys: MetaSnippetKey[] = [];
  for (const p of normalizePaths(touchedPaths)) {
    if (p === "meta.page_title") keys.push("page_title");
    if (p === "meta.description") keys.push("description");
  }
  return keys;
}

export function resolveMicroValidationFlags(opts: {
  intent: ValidationIntent;
  touchedPaths?: readonly string[];
  requiredEditorKeys?: readonly string[];
}): MicroValidationFlags {
  const { intent, touchedPaths = [], requiredEditorKeys = [] } = opts;

  if (intent === "publish") {
    return {
      runFull: true,
      metaKeys: null,
      bodyKeys: null,
      runEmptyDetached: true,
      runSchemaOrgCompanion: true,
      runFormSources: true,
      runClusterLinks: true,
    };
  }

  const paths = normalizePaths(touchedPaths);

  // Empty touchedPaths on micro = skip full gate (structural add/reorder, unspecified micro).
  // Full enforcement is intent: "publish" (promote / replace_all_sections / full locale YAML).
  if (paths.length === 0) {
    return {
      runFull: false,
      metaKeys: [],
      bodyKeys: [],
      runEmptyDetached: false,
      runSchemaOrgCompanion: false,
      runFormSources: false,
      runClusterLinks: false,
    };
  }

  if (isCommonOperationalOnly(paths)) {
    return {
      runFull: false,
      metaKeys: [],
      bodyKeys: [],
      runEmptyDetached: false,
      runSchemaOrgCompanion: false,
      runFormSources: false,
      runClusterLinks: false,
    };
  }

  const snippetKeys = metaSnippetKeysFromPaths(paths);
  const touchedBody = paths.filter(
    (p) => !p.startsWith("meta.") && requiredEditorKeys.includes(p),
  );

  const onlyVisibilityOrOptional = paths.every(
    (p) =>
      META_VISIBILITY_PATHS.has(p) ||
      META_OPTIONAL_PATHS.has(p) ||
      COMMON_OPERATIONAL_PATHS.has(p),
  );

  if (onlyVisibilityOrOptional && snippetKeys.length === 0 && touchedBody.length === 0) {
    return {
      runFull: false,
      metaKeys: [],
      bodyKeys: [],
      runEmptyDetached: false,
      runSchemaOrgCompanion: false,
      runFormSources: false,
      runClusterLinks: false,
    };
  }

  return {
    runFull: false,
    metaKeys: snippetKeys.length > 0 ? snippetKeys : [],
    bodyKeys: touchedBody.length > 0 ? touchedBody : [],
    runEmptyDetached: false,
    runSchemaOrgCompanion: false,
    runFormSources: false,
    runClusterLinks: false,
  };
}

/** Skip live gate entirely for this micro write. */
export function shouldSkipLiveGate(
  intent: ValidationIntent,
  touchedPaths?: readonly string[],
): boolean {
  if (intent === "publish") return false;
  const flags = resolveMicroValidationFlags({ intent, touchedPaths });
  if (flags.runFull) return false;
  return (
    (flags.metaKeys?.length ?? 0) === 0 &&
    (flags.bodyKeys?.length ?? 0) === 0 &&
    !flags.runEmptyDetached &&
    !flags.runSchemaOrgCompanion &&
    !flags.runFormSources &&
    !flags.runClusterLinks
  );
}
