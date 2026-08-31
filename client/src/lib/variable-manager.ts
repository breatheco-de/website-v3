import { parsePipeFallback } from "@shared/json-field";
import {
  EXACT_ENTRY_OR_SINGLE_VAR_PATTERN,
  entryBagFieldPathFromVarName,
  formatEntryVarName,
  isEntryOrSingleVarName,
} from "@shared/entryTemplateVars";

const TEMPLATE_REGEX = /\{\{\s*([^|}]+?)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;
const META_PREFIX = "meta.";
const PARAM_PREFIX = "param.";
const EXACT_META_VAR_PATTERN = /^\{\{\s*meta\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([\s\S]*?))?\s*\}\}$/;
const EXACT_PARAM_VAR_PATTERN = /^\{\{\s*param\.([a-zA-Z_][a-zA-Z0-9_.]*)\s*(?:\|\s*([\s\S]*?))?\s*\}\}$/;

export interface VariableCondition {
  query: Record<string, string>;
  value: string;
}

export interface VariableDefinition {
  default?: string;
  conditions?: VariableCondition[];
  by_locale?: Record<string, string>;
  by_region?: Record<string, string>;
  by_location?: Record<string, string>;
}

export interface VariableContext {
  location?: string;
  region?: string;
  locale?: string;
}

export interface ResolvedVariable {
  original: string;
  variableName: string;
  resolvedValue: string;
  source: "condition" | "location" | "region" | "locale" | "default" | "inline" | "single" | "meta" | "param";
  defaultValue: string;
}

export interface ResolveOptions {
  preserveTemplate?: boolean;
  singleEntry?: Record<string, unknown>;
  /** Resolved (or raw) page SEO meta for {{ meta.* }} */
  meta?: Record<string, unknown>;
  /** Unified URL path + querystring params for {{ param.* }} */
  param?: Record<string, unknown>;
}

function getNestedValue(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function resolveVariable(
  name: string,
  definitions: Record<string, VariableDefinition>,
  context: VariableContext,
): { value: string; source: ResolvedVariable["source"] } | null {
  const def = definitions[name];
  if (!def) return null;

  if (def.conditions && def.conditions.length > 0) {
    for (const condition of def.conditions) {
      const matches = Object.entries(condition.query).every(([key, val]) => {
        const contextVal = (context as Record<string, string | undefined>)[key];
        return contextVal === val;
      });
      if (matches) {
        return { value: condition.value, source: "condition" };
      }
    }
  }

  if (context.location && def.by_location?.[context.location]) {
    return { value: def.by_location[context.location], source: "location" };
  }
  if (context.region && def.by_region?.[context.region]) {
    return { value: def.by_region[context.region], source: "region" };
  }
  if (context.locale && def.by_locale?.[context.locale]) {
    return { value: def.by_locale[context.locale], source: "locale" };
  }
  if (def.default !== undefined) {
    return { value: def.default, source: "default" };
  }
  return null;
}

function resolveSingleVariable(
  fieldPath: string,
  singleEntry: Record<string, unknown>,
): { value: unknown; source: "single" } | null {
  const value = getNestedValue(singleEntry, fieldPath);
  if (value !== undefined && value !== null) {
    return { value, source: "single" };
  }
  return null;
}

function resolveMetaVariable(
  fieldPath: string,
  meta: Record<string, unknown>,
): { value: unknown; source: "meta" } | null {
  const value = getNestedValue(meta, fieldPath);
  if (value !== undefined && value !== null) {
    return { value, source: "meta" };
  }
  return null;
}

function resolveParamVariable(
  fieldPath: string,
  param: Record<string, unknown>,
): { value: unknown; source: "param" } | null {
  const value = getNestedValue(param, fieldPath);
  if (value !== undefined && value !== null) {
    return { value, source: "param" };
  }
  return null;
}

function bagValueToDisplay(value: unknown): string {
  return String(typeof value === "object" ? JSON.stringify(value) : value);
}

export function resolveTemplateString(
  text: string,
  definitions: Record<string, VariableDefinition>,
  context: VariableContext,
  options?: ResolveOptions,
): { text: string; variables: ResolvedVariable[] } {
  if (typeof text !== "string") return { text: String(text ?? ""), variables: [] };
  const variables: ResolvedVariable[] = [];
  const regex = new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags);
  const preserveTemplate = options?.preserveTemplate ?? false;
  const singleEntry = options?.singleEntry;
  const meta = options?.meta;
  const param = options?.param;

  const resolved = text.replace(regex, (match, expression: string, inlineDefault: string) => {
    const name = expression.trim();
    const defVal = (inlineDefault || "").trim();

    if (isEntryOrSingleVarName(name)) {
      if (!singleEntry) {
        return match;
      }
      const fieldPath = entryBagFieldPathFromVarName(name)!;
      const singleResult = resolveSingleVariable(fieldPath, singleEntry);

      if (preserveTemplate) {
        if (!singleResult && !defVal) {
          return match;
        }
        const displayValue = singleResult ? bagValueToDisplay(singleResult.value) : defVal;
        variables.push({
          original: match,
          variableName: name,
          resolvedValue: displayValue,
          source: singleResult ? "single" : "inline",
          defaultValue: defVal,
        });
        return `{{ ${name} | ${displayValue} }}`;
      }

      const singleValue = singleResult ? bagValueToDisplay(singleResult.value) : defVal || name;
      variables.push({
        original: match,
        variableName: name,
        resolvedValue: singleValue,
        source: singleResult ? "single" : "inline",
        defaultValue: defVal,
      });
      return singleValue;
    }

    if (name.startsWith(META_PREFIX)) {
      if (!meta) {
        return match;
      }
      const fieldPath = name.slice(META_PREFIX.length);
      const metaResult = resolveMetaVariable(fieldPath, meta);

      if (preserveTemplate) {
        if (!metaResult && !defVal) {
          return match;
        }
        const displayValue = metaResult ? bagValueToDisplay(metaResult.value) : defVal;
        variables.push({
          original: match,
          variableName: name,
          resolvedValue: displayValue,
          source: metaResult ? "meta" : "inline",
          defaultValue: defVal,
        });
        return `{{ ${name} | ${displayValue} }}`;
      }

      const metaValue = metaResult ? bagValueToDisplay(metaResult.value) : defVal || name;
      variables.push({
        original: match,
        variableName: name,
        resolvedValue: metaValue,
        source: metaResult ? "meta" : "inline",
        defaultValue: defVal,
      });
      return metaValue;
    }

    if (name.startsWith(PARAM_PREFIX)) {
      if (!param) {
        return match;
      }
      const fieldPath = name.slice(PARAM_PREFIX.length);
      const paramResult = resolveParamVariable(fieldPath, param);

      if (preserveTemplate) {
        if (!paramResult && !defVal) {
          return match;
        }
        const displayValue = paramResult ? bagValueToDisplay(paramResult.value) : defVal;
        variables.push({
          original: match,
          variableName: name,
          resolvedValue: displayValue,
          source: paramResult ? "param" : "inline",
          defaultValue: defVal,
        });
        return `{{ ${name} | ${displayValue} }}`;
      }

      const paramValue = paramResult ? bagValueToDisplay(paramResult.value) : defVal || name;
      variables.push({
        original: match,
        variableName: name,
        resolvedValue: paramValue,
        source: paramResult ? "param" : "inline",
        defaultValue: defVal,
      });
      return paramValue;
    }

    const result = resolveVariable(name, definitions, context);
    const value = result?.value || defVal || name;
    const source = result?.source || "inline";

    variables.push({
      original: match,
      variableName: name,
      resolvedValue: value,
      source,
      defaultValue: defVal,
    });

    if (preserveTemplate) {
      if (!result && !defVal) {
        return match;
      }
      return `{{ ${name} | ${value} }}`;
    }
    return value;
  });

  return { text: resolved, variables };
}

export function resolveDeep(
  data: unknown,
  definitions: Record<string, VariableDefinition>,
  context: VariableContext,
  options?: ResolveOptions,
): { data: unknown; variables: ResolvedVariable[] } {
  const allVariables: ResolvedVariable[] = [];
  const singleEntry = options?.singleEntry;
  const meta = options?.meta;
  const param = options?.param;

  function walk(value: unknown): unknown {
    if (typeof value === "string") {
      if (!options?.preserveTemplate) {
        if (singleEntry) {
          const exactMatch = value.match(EXACT_ENTRY_OR_SINGLE_VAR_PATTERN);
          if (exactMatch) {
            const fieldPath = exactMatch[1];
            const hasFallback = exactMatch[2] !== undefined;
            const fallback = exactMatch[2]?.trim();
            const resolved = getNestedValue(singleEntry, fieldPath);
            const resolvedValue =
              resolved !== undefined && resolved !== null
                ? resolved
                : hasFallback
                  ? parsePipeFallback(fallback ?? "")
                  : value;
            const displayValue = typeof resolvedValue === "object" ? JSON.stringify(resolvedValue) : String(resolvedValue);

            allVariables.push({
              original: value,
              variableName: formatEntryVarName(fieldPath),
              resolvedValue: displayValue,
              source: resolved !== undefined && resolved !== null ? "single" : "inline",
              defaultValue: fallback || "",
            });

            return resolvedValue;
          }
        }

        if (meta) {
          const exactMeta = value.match(EXACT_META_VAR_PATTERN);
          if (exactMeta) {
            const fieldPath = exactMeta[1];
            const hasFallback = exactMeta[2] !== undefined;
            const fallback = exactMeta[2]?.trim();
            const resolved = getNestedValue(meta, fieldPath);
            const resolvedValue =
              resolved !== undefined && resolved !== null
                ? resolved
                : hasFallback
                  ? parsePipeFallback(fallback ?? "")
                  : value;
            const displayValue = typeof resolvedValue === "object" ? JSON.stringify(resolvedValue) : String(resolvedValue);

            allVariables.push({
              original: value,
              variableName: `meta.${fieldPath}`,
              resolvedValue: displayValue,
              source: resolved !== undefined && resolved !== null ? "meta" : "inline",
              defaultValue: fallback || "",
            });

            return resolvedValue;
          }
        }

        if (param) {
          const exactParam = value.match(EXACT_PARAM_VAR_PATTERN);
          if (exactParam) {
            const fieldPath = exactParam[1];
            const hasFallback = exactParam[2] !== undefined;
            const fallback = exactParam[2]?.trim();
            const resolved = getNestedValue(param, fieldPath);
            const resolvedValue =
              resolved !== undefined && resolved !== null
                ? resolved
                : hasFallback
                  ? parsePipeFallback(fallback ?? "")
                  : value;
            const displayValue = typeof resolvedValue === "object" ? JSON.stringify(resolvedValue) : String(resolvedValue);

            allVariables.push({
              original: value,
              variableName: `param.${fieldPath}`,
              resolvedValue: displayValue,
              source: resolved !== undefined && resolved !== null ? "param" : "inline",
              defaultValue: fallback || "",
            });

            return resolvedValue;
          }
        }
      }

      const { text, variables } = resolveTemplateString(value, definitions, context, options);
      allVariables.push(...variables);
      return text;
    }
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = walk(v);
      }
      return result;
    }
    return value;
  }

  const resolved = walk(data);
  return { data: resolved, variables: allVariables };
}

export function resolveTemplateFallback(text: string): string {
  return text.replace(
    new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags),
    (match, _expr: string, fallback: string) => {
      const val = (fallback || "").trim();
      return val || match;
    }
  );
}

/**
 * Coerces a resolved single-entry value to a renderable string. Static YAML
 * content can resolve template variables like {{ single.category }} to raw
 * objects (e.g. { slug: "..." }); rendering those directly as React children
 * crashes the page. Picks a sensible text field from objects, else "".
 */
export function coerceToText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const candidate = obj.text ?? obj.label ?? obj.name ?? obj.title ?? obj.slug;
    if (typeof candidate === "string" || typeof candidate === "number") return String(candidate);
  }
  return "";
}

/**
 * Like coerceToText, but preserves HTML strings unchanged so rich-text
 * fields keep their markup. Non-string values are coerced to plain text.
 */
export function coerceToHtml(value: unknown): string {
  return typeof value === "string" ? value : coerceToText(value);
}

export function hasTemplateVariables(text: string): boolean {
  return new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags).test(text);
}

export function extractTemplateTokens(text: string): Array<{ original: string; variableName: string; defaultValue: string; start: number; end: number }> {
  const tokens: Array<{ original: string; variableName: string; defaultValue: string; start: number; end: number }> = [];
  const regex = new RegExp(TEMPLATE_REGEX.source, TEMPLATE_REGEX.flags);
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    tokens.push({
      original: match[0],
      variableName: match[1].trim(),
      defaultValue: (match[2] || "").trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}
