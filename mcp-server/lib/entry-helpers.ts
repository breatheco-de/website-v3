/**
 * Helpers for create_entry / list_entry_seo / get_content_type_info / SAFE_TOP_LEVEL.
 * Rules are driven by content-type config — never hardcode a contentType name.
 */
import {
  isDbBacked,
  isSharedLayoutConfig,
  type ContentTypeConfig,
} from "./content.js";
import { actionRequired, type McpTextResult, type NextAction } from "./respond.js";
import {
  listRequiredEditorFields,
  validateRequiredFields,
  normalizeRequiredFlag,
  type ListRequiredEditorFieldsOpts,
} from "../../shared/validateRequiredFields.js";
import { LOCALE_ONLY_URL_PARAMS } from "../../shared/urlParamRules.js";

export const MULTI_SITE_TOOL_BLURB =
  "Multi-site: always pass site (domain from sites.yml / list_sites; matching is case-insensitive). Never assume the first site or default to any domain — use the domain the user named. If unsure, call list_sites first.";

export const SITE_PARAM_DESC =
  'Domain of the target site from sites.yml, e.g. "example.com" (required when multiple sites are configured; optional when only one site exists). ' +
  MULTI_SITE_TOOL_BLURB;

/** editor.type values allowed as top-level batch/update paths (plus title/slug/settings). */
export const SAFE_EDITOR_TYPES = new Set([
  "text",
  "textarea",
  "markdown",
  "tags",
  "select",
  "datetime",
  "date",
  "image",
  "pdf",
  "boolean",
  "number",
  "json",
  "relation",
]);

export function listExtraUrlPatternParams(
  urlPattern?: Record<string, string> | null,
): string[] {
  if (!urlPattern) return [];
  const keys = new Set<string>();
  for (const pattern of Object.values(urlPattern)) {
    if (!pattern) continue;
    const matches = pattern.match(/:([a-zA-Z_]+)/g) || [];
    for (const m of matches) {
      const key = m.slice(1);
      if (key !== "slug" && key !== "locale") keys.add(key);
    }
  }
  return [...keys];
}

export type EditorFieldHint = {
  required?: boolean | "attached";
  type?: string;
  allow_custom_values?: boolean;
  populate_options?: boolean;
  description?: string;
  /** Required when type is `json` — JSON Schema contract for agents and saves. */
  schema?: Record<string, unknown>;
};

export function getEditorConfig(config: ContentTypeConfig): Record<string, EditorFieldHint> {
  const editor = (config as { editor?: Record<string, EditorFieldHint> }).editor;
  return editor && typeof editor === "object" ? editor : {};
}

/** Effective required keys for create/go-live (defaults: shared-layout aware, not detached). */
export function requiredEditorFields(
  config: ContentTypeConfig,
  opts?: ListRequiredEditorFieldsOpts,
): string[] {
  const editor = getEditorConfig(config);
  return listRequiredEditorFields(editor, {
    isSharedLayout: opts?.isSharedLayout ?? isSharedLayoutConfig(config),
    isDetached: opts?.isDetached ?? false,
  });
}

/** Per-field required mode for get_content_type_info (`false` | `true` | `attached`). */
export function editorRequiredModes(
  config: ContentTypeConfig,
): Record<string, false | true | "attached"> {
  const out: Record<string, false | true | "attached"> = {};
  for (const [key, hint] of Object.entries(getEditorConfig(config))) {
    const flag = normalizeRequiredFlag(hint?.required);
    out[key] = flag === false ? false : flag;
  }
  return out;
}

/** Top-level field paths writable via update_fields. */
export function safeTopLevelFieldsForConfig(config: ContentTypeConfig): Set<string> {
  const allowed = new Set(["title", "slug", "settings"]);
  const editor = getEditorConfig(config);
  const mapping = config.field_mapping || {};
  for (const key of Object.keys(mapping)) {
    if (key.startsWith("_")) continue;
    const hint = editor[key];
    if (hint?.type && SAFE_EDITOR_TYPES.has(hint.type)) {
      allowed.add(key);
    } else if (
      !hint &&
      ["title", "description", "content", "tags", "lang", "status", "image", "category"].includes(key)
    ) {
      allowed.add(key);
    }
  }
  for (const [key, hint] of Object.entries(editor)) {
    if (hint?.type && SAFE_EDITOR_TYPES.has(hint.type)) allowed.add(key);
  }
  return allowed;
}

export function extractParamSlug(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const slug = (value as Record<string, unknown>).slug;
    if (typeof slug === "string" && slug.trim()) return slug.trim();
  }
  return null;
}

/** URL params that must live on locale YAML only (never _common.yml). Re-export for MCP callers. */
export { LOCALE_ONLY_URL_PARAMS, isLocaleOnlyUrlParam } from "../../shared/urlParamRules.js";

export {
  localeYamlCandidatesForObserve,
  observeParamValues,
  observeParamValuesByLocale,
  validateUrlParamPeerValues,
  collectProposedUrlParamValuesByLocale,
  type UrlParamPeerGateFailure,
} from "../../server/url-param-peers.js";

export function collectProposedUrlParamValues(
  common: Record<string, unknown>,
  locales: Record<string, Record<string, unknown>>,
  params: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const param of params) {
    if (LOCALE_ONLY_URL_PARAMS.has(param)) {
      for (const locData of Object.values(locales)) {
        const v = extractParamSlug(locData[param]);
        if (v) {
          out[param] = v;
          break;
        }
      }
      continue;
    }
    const fromCommon = extractParamSlug(common[param]);
    if (fromCommon) {
      out[param] = fromCommon;
      continue;
    }
    for (const locData of Object.values(locales)) {
      const v = extractParamSlug(locData[param]);
      if (v) {
        out[param] = v;
        break;
      }
    }
  }
  return out;
}

export function missingRequiredFields(
  config: ContentTypeConfig,
  common: Record<string, unknown>,
  localePayload: Record<string, unknown>,
  opts?: ListRequiredEditorFieldsOpts,
): string[] {
  const merged = { ...common, ...localePayload };
  const result = validateRequiredFields(
    getEditorConfig(config),
    merged,
    "publish",
    {
      isSharedLayout: opts?.isSharedLayout ?? isSharedLayoutConfig(config),
      isDetached: opts?.isDetached ?? false,
    },
  );
  if (result.ok) return [];
  return [...new Set(result.errors.map((e) => e.field))];
}

export function siteFailResult(
  errorJson: string,
  tool?: string,
  retryArgs?: Record<string, unknown>,
): McpTextResult {
  let parsed: {
    error?: string;
    message?: string;
    available_sites?: string[];
    requested_site?: string;
  };
  try {
    parsed = JSON.parse(errorJson) as typeof parsed;
  } catch {
    return actionRequired(
      { success: false, action_required: "site_required", message: errorJson },
      [{ tool: "list_sites", reason: "List configured site domains", priority: "required" }],
    );
  }
  const sites = parsed.available_sites ?? [];
  const requestedSite =
    typeof parsed.requested_site === "string" && parsed.requested_site.trim()
      ? parsed.requested_site.trim()
      : undefined;
  const next: NextAction[] = [
    {
      tool: "list_sites",
      reason: "List configured domains and content folders",
      priority: "required",
    },
  ];
  // Unknown site: retry preserves other args but omits site (avoids typo loops / sites[0] nudge).
  // Missing site: list_sites only — never invent a default domain.
  const isUnknown =
    parsed.error === "unknown_site" || requestedSite !== undefined;
  if (tool && isUnknown) {
    const hint = { ...(retryArgs || {}) };
    delete hint.site;
    next.push({
      tool,
      reason: "Retry after choosing a domain from available_sites / list_sites",
      priority: "required",
      args_hint: hint,
    });
  }
  return actionRequired(
    {
      success: false,
      action_required: parsed.error || "multi_site_domain_required",
      message:
        (parsed.message || "Pass the site parameter (domain).") +
        " " +
        MULTI_SITE_TOOL_BLURB,
      available_sites: sites,
      ...(requestedSite ? { requested_site: requestedSite } : {}),
    },
    next,
  );
}

export function bodyModelForConfig(config: ContentTypeConfig): string {
  if (isSharedLayoutConfig(config)) {
    return "locale_fields_plus_shared_single";
  }
  return "sections_owned";
}

export function createViaForConfig(config: ContentTypeConfig): "create_entry" | null {
  return isDbBacked(config) ? null : "create_entry";
}
