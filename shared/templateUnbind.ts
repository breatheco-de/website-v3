import { parsePipeFallback } from "@shared/json-field";
import {
  isEntryOrSingleVarName,
} from "@shared/entryTemplateVars";

const EXACT_TEMPLATE_EXPR =
  /^\{\{\s*([^|}]+?)\s*(?:\|\s*([\s\S]*?))?\s*\}\}$/;

export interface TemplateUnbindDefinition {
  default?: string;
  conditions?: Array<{ query: Record<string, string>; value: string }>;
  by_locale?: Record<string, string>;
  by_region?: Record<string, string>;
  by_location?: Record<string, string>;
}

export interface TemplateUnbindContext {
  location?: string;
  region?: string;
  locale?: string;
}

export interface ParsedTemplateExpression {
  name: string;
  inlineFallback?: string;
  raw: string;
}

const META_PREFIX = "meta.";
const PARAM_PREFIX = "param.";

export function parseTemplateExpression(match: string): ParsedTemplateExpression | null {
  const m = match.trim().match(EXACT_TEMPLATE_EXPR);
  if (!m) return null;
  const name = m[1].trim();
  const inlineFallback = m[2] !== undefined ? m[2].trim() : undefined;
  return { name, inlineFallback, raw: match.trim() };
}

function resolveGlobalDefault(
  name: string,
  definitions: Record<string, TemplateUnbindDefinition>,
  context: TemplateUnbindContext,
): string | undefined {
  const def = definitions[name];
  if (!def) return undefined;

  if (def.conditions?.length) {
    for (const condition of def.conditions) {
      const matches = Object.entries(condition.query).every(([key, val]) => {
        const contextVal = (context as Record<string, string | undefined>)[key];
        return contextVal === val;
      });
      if (matches) return condition.value;
    }
  }

  if (context.location && def.by_location?.[context.location]) {
    return def.by_location[context.location];
  }
  if (context.region && def.by_region?.[context.region]) {
    return def.by_region[context.region];
  }
  if (context.locale && def.by_locale?.[context.locale]) {
    return def.by_locale[context.locale];
  }
  if (def.default !== undefined) return def.default;
  return undefined;
}

/**
 * Suggested static value for the ReplaceBindingModal (pipe fallback or global default).
 * Does not use live single-entry resolved values.
 */
export function getSuggestedUnbindDefault(
  expr: string,
  options?: {
    definitions?: Record<string, TemplateUnbindDefinition>;
    context?: TemplateUnbindContext;
  },
): unknown {
  const parsed = parseTemplateExpression(expr);
  if (!parsed) return "";

  if (parsed.inlineFallback !== undefined) {
    return parsePipeFallback(parsed.inlineFallback);
  }

  const name = parsed.name;
  if (
    isEntryOrSingleVarName(name) ||
    name.startsWith(META_PREFIX) ||
    name.startsWith(PARAM_PREFIX)
  ) {
    return "";
  }

  const definitions = options?.definitions ?? {};
  const context = options?.context ?? {};
  const global = resolveGlobalDefault(name, definitions, context);
  if (global !== undefined) return global;
  return "";
}

export function formatUnbindLiteralForInsert(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Replace template span within a YAML string field value (mixed literals). */
export function applyUnbindToFieldValue(
  fieldValue: string,
  spanFrom: number,
  spanTo: number,
  literal: string,
): string {
  return fieldValue.slice(0, spanFrom) + literal + fieldValue.slice(spanTo);
}

export const TEMPLATE_EXPR_PATTERN = /\{\{\s*([^|}]+?)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;

export function fieldValueContainsTemplate(value: unknown): boolean {
  return typeof value === "string" && TEMPLATE_EXPR_PATTERN.test(value);
}
