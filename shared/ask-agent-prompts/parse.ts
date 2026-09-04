import yaml from "js-yaml";
import type { AskAgentPromptFrontmatter, AskAgentPromptTemplate } from "./types";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

function asString(v: unknown, field: string): string {
  if (typeof v !== "string" || !v.trim()) {
    throw new Error(`Ask Agent frontmatter.${field} must be a non-empty string`);
  }
  return v.trim();
}

function asStringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || v.length === 0 || v.some((x) => typeof x !== "string" || !x.trim())) {
    throw new Error(`Ask Agent frontmatter.${field} must be a non-empty string array`);
  }
  return v.map((x) => String(x).trim());
}

function asPositiveInt(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1 || Math.floor(v) !== v) {
    throw new Error(`Ask Agent frontmatter.${field} must be a positive integer`);
  }
  return v;
}

export function parseAskAgentPromptMarkdown(raw: string): AskAgentPromptTemplate {
  const text = raw.replace(/^\uFEFF/, "");
  const m = FRONTMATTER_RE.exec(text);
  if (!m) {
    throw new Error("Ask Agent template must start with YAML frontmatter between --- fences");
  }
  const parsed = yaml.load(m[1]!) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ask Agent frontmatter must be a YAML object");
  }

  const frontmatter: AskAgentPromptFrontmatter = {
    id: asString(parsed.id, "id"),
    version: asPositiveInt(parsed.version, "version"),
    title: asString(parsed.title, "title"),
    used_when: asString(parsed.used_when, "used_when"),
    intention: asString(parsed.intention, "intention"),
    success_looks_like: asString(parsed.success_looks_like, "success_looks_like"),
    failure_modes: asStringArray(parsed.failure_modes, "failure_modes"),
    required: asStringArray(parsed.required, "required"),
    max_chars: asPositiveInt(parsed.max_chars, "max_chars"),
    sections: asStringArray(parsed.sections, "sections"),
  };

  const body = (m[2] ?? "").replace(/^\n+/, "").replace(/\n+$/, "") + "\n";
  if (!body.trim()) {
    throw new Error(`Ask Agent template ${frontmatter.id} has an empty body`);
  }

  return { frontmatter, body, raw: text.endsWith("\n") ? text : `${text}\n` };
}

/** Breaks `{{name}}` so leftover detection ignores braces that came from substituted values. */
const PLACEHOLDER_GUARD = "\u200B";

function guardEmbeddedPlaceholders(value: string): string {
  return value.replace(/\{\{/g, `{{${PLACEHOLDER_GUARD}`);
}

function unguardEmbeddedPlaceholders(value: string): string {
  return value.replaceAll(`{{${PLACEHOLDER_GUARD}`, "{{");
}

/** Replace `{{name}}` placeholders. Throws if a required var is missing or leftovers remain.
 * Placeholders that appear inside substituted values (e.g. embedded template raw) are kept
 * and do not count as leftovers. */
export function interpolateAskAgentBody(
  body: string,
  vars: Record<string, string>,
  required: string[],
): string {
  for (const key of required) {
    if (!(key in vars) || vars[key] == null) {
      throw new Error(`Ask Agent prompt missing required var: ${key}`);
    }
  }
  let out = body;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(guardEmbeddedPlaceholders(String(value)));
  }
  const leftover = out.match(/\{\{[a-zA-Z0-9_]+\}\}/g);
  if (leftover?.length) {
    throw new Error(`Ask Agent prompt has unsubstituted placeholders: ${leftover.join(", ")}`);
  }
  return unguardEmbeddedPlaceholders(out).replace(/\n+$/, "") + "\n";
}
