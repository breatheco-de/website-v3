const VAR_PATTERN = /\{\{[\s]*([^}|]+?)(?:\s*\|\s*([\s\S]*?))?\s*\}\}/g;

export interface EscapeResult {
  escaped: string;
  map: Map<string, string>;
}

export function escapeTemplateVars(yamlStr: string): EscapeResult {
  const map = new Map<string, string>();
  let counter = 0;
  const escaped = yamlStr.replace(VAR_PATTERN, (match) => {
    const placeholder = `__TPL_${counter++}__`;
    map.set(placeholder, match);
    return placeholder;
  });
  return { escaped, map };
}

export function unescapeStringVars(str: string, map: Map<string, string>): string {
  let result = str;
  for (const [placeholder, original] of map) {
    result = result.split(placeholder).join(original);
  }
  return result;
}

export function unescapeObjectVars(obj: unknown, map: Map<string, string>): unknown {
  if (map.size === 0) return obj;
  if (typeof obj === "string") {
    return unescapeStringVars(obj, map);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => unescapeObjectVars(item, map));
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = unescapeObjectVars(value, map);
    }
    return result;
  }
  return obj;
}

function escapeString(str: string, map: Map<string, string>, counterRef: { value: number }): string {
  return str.replace(VAR_PATTERN, (match) => {
    const placeholder = `__TPL_${counterRef.value++}__`;
    map.set(placeholder, match);
    return placeholder;
  });
}

export function escapeObjectVars(obj: unknown, map?: Map<string, string>, counterRef?: { value: number }): { escaped: unknown; map: Map<string, string> } {
  const m = map || new Map<string, string>();
  const c = counterRef || { value: 0 };

  if (typeof obj === "string") {
    return { escaped: escapeString(obj, m, c), map: m };
  }
  if (Array.isArray(obj)) {
    const escapedArr = obj.map((item) => escapeObjectVars(item, m, c).escaped);
    return { escaped: escapedArr, map: m };
  }
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = escapeObjectVars(value, m, c).escaped;
    }
    return { escaped: result, map: m };
  }
  return { escaped: obj, map: m };
}

/** Key js-yaml produces when an unescaped `{{ x }}` is parsed as a flow mapping. */
export const CORRUPTED_TEMPLATE_KEY = "[object Object]";

/** Paths (e.g. `sections.1.updated_at`) whose value carries the corrupted template key. */
export function findCorruptedTemplateKeys(obj: unknown, prefix = ""): string[] {
  if (Array.isArray(obj)) {
    return obj.flatMap((item, i) => findCorruptedTemplateKeys(item, prefix ? `${prefix}.${i}` : String(i)));
  }
  if (!obj || typeof obj !== "object") return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    if (key === CORRUPTED_TEMPLATE_KEY) {
      out.push(prefix || "(root)");
      continue;
    }
    out.push(...findCorruptedTemplateKeys(value, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

export class CorruptedTemplateValueError extends Error {
  readonly code = "corrupted_template_value";
  constructor(
    readonly paths: string[],
    readonly file?: string,
  ) {
    super(
      `Save blocked: ${file ? `${file} has` : "this content has"} a broken template value at ${paths.join(", ")} ` +
        `(a {{ … }} placeholder was turned into "${CORRUPTED_TEMPLATE_KEY}"). Nothing was written. ` +
        "Report this to the dev team so they can fix the code path that read the file.",
    );
    this.name = "CorruptedTemplateValueError";
  }
}

export function assertNoCorruptedTemplateKeys(obj: unknown, file?: string): void {
  const paths = findCorruptedTemplateKeys(obj);
  if (paths.length > 0) throw new CorruptedTemplateValueError(paths, file);
}

export function unescapeYamlDump(yamlStr: string, map: Map<string, string>): string {
  let result = yamlStr;
  for (const [placeholder, original] of map) {
    result = result.split(`"${placeholder}"`).join(original);
    result = result.split(`'${placeholder}'`).join(original);
    result = result.split(placeholder).join(original);
  }
  return result;
}
