/**
 * Read/write content YAML without corrupting unquoted `{{ … }}` placeholders.
 *
 * Plain `yaml.load` parses `key: {{ entry.x }}` as a nested flow mapping, and js-yaml
 * stringifies its key to `"[object Object]"`; a later `yaml.dump` then persists
 * `key: {"[object Object]": null}` and the placeholder is gone.
 */
import yaml from "js-yaml";
import {
  assertNoCorruptedTemplateKeys,
  escapeObjectVars,
  escapeTemplateVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "../shared/templateVars";

export function loadContentYaml(raw: string): unknown {
  const { escaped, map } = escapeTemplateVars(raw);
  return unescapeObjectVars(yaml.load(escaped), map);
}

/** Like {@link loadContentYaml}, but `null` for non-object documents. Throws on invalid YAML. */
export function loadContentYamlObject(raw: string): Record<string, unknown> | null {
  const parsed = loadContentYaml(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : null;
}

/**
 * Throws `CorruptedTemplateValueError` (nothing to write) when the data carries a
 * `"[object Object]"` key, so a save never persists a destroyed placeholder.
 */
export function dumpContentYaml(obj: unknown, opts?: yaml.DumpOptions, file?: string): string {
  assertNoCorruptedTemplateKeys(obj, file);
  const { escaped, map } = escapeObjectVars(obj);
  return unescapeYamlDump(yaml.dump(escaped, opts), map);
}
