import vm from "vm";
import { child } from "./logger";
import {
  FUNCTION_PREFIX,
  decodeUtf8Base64,
} from "@shared/functionEncoding";
const log = child({ module: "transform" });



export { FUNCTION_PREFIX };
export const OPTIONAL_PREFIX = "?";

const transformTimeoutLastWarn = new Map<string, number>();

function warnTransformTimeout(contentType: string, slug: string, fieldPath: string, message: string): void {
  const key = `${contentType}:${slug}:${fieldPath}`;
  const now = Date.now();
  const last = transformTimeoutLastWarn.get(key) ?? 0;
  if (now - last >= 60_000) {
    transformTimeoutLastWarn.set(key, now);
    log.warn(`[Transform] Runtime error in transformer (${contentType}/${slug} field=${fieldPath}): ${message}`);
  }
}

export function getValueByPath(obj: unknown, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function isTransformer(value: string): boolean {
  return value.startsWith(FUNCTION_PREFIX);
}

export function extractFunctionBody(prefixedValue: string): string {
  const encoded = prefixedValue.slice(FUNCTION_PREFIX.length);
  return decodeUtf8Base64(encoded);
}

interface CompiledTransformer {
  source: string;
  script: vm.Script;
}

const compiledCache = new Map<string, CompiledTransformer | null>();

export function compileTransformer(prefixedValue: string): CompiledTransformer | null {
  if (compiledCache.has(prefixedValue)) {
    return compiledCache.get(prefixedValue)!;
  }

  try {
    const body = extractFunctionBody(prefixedValue);
    const wrappedSource = `(__fn_expr__ = ${body})(__value__, __item__)`;
    const script = new vm.Script(wrappedSource, { filename: "transformer.js" });
    const compiled: CompiledTransformer = { source: body, script };
    compiledCache.set(prefixedValue, compiled);
    return compiled;
  } catch (err) {
    log.warn(`[Transform] Failed to compile transformer: ${err}`);
    compiledCache.set(prefixedValue, null);
    return null;
  }
}

const sharedSandbox: Record<string, unknown> = { __value__: undefined, __item__: undefined, __fn_expr__: undefined };
const sharedVmContext = vm.createContext(sharedSandbox);

export function runTransformer(
  compiled: CompiledTransformer,
  value: unknown,
  item: Record<string, unknown>,
  context?: { contentType?: string; slug?: string; fieldPath?: string },
): unknown {
  try {
    sharedSandbox.__value__ = value;
    sharedSandbox.__item__ = item;
    sharedSandbox.__fn_expr__ = undefined;
    return compiled.script.runInContext(sharedVmContext, { timeout: 50 });
  } catch (err) {
    const contentType = context?.contentType ?? "unknown";
    const slug = context?.slug ?? "unknown";
    const fieldPath = context?.fieldPath ?? "unknown";
    const errMsg = err instanceof Error ? err.message : String(err);
    warnTransformTimeout(contentType, slug, fieldPath, errMsg);
    return undefined;
  }
}

export function isOptionalSource(value: string): boolean {
  return value.startsWith(OPTIONAL_PREFIX);
}

export function stripOptionalPrefix(value: string): string {
  return value.startsWith(OPTIONAL_PREFIX) ? value.slice(OPTIONAL_PREFIX.length) : value;
}

export function resolveFieldValue(
  sourcePath: string,
  item: Record<string, unknown>,
  targetKey?: string,
  context?: { contentType?: string; slug?: string; fieldPath?: string },
): unknown {
  const effectivePath = stripOptionalPrefix(sourcePath);
  if (isTransformer(effectivePath)) {
    const compiled = compileTransformer(effectivePath);
    if (!compiled) return undefined;
    const rawValue = targetKey ? item[targetKey] : undefined;
    const resolvedContext = context ?? {
      fieldPath: targetKey ?? effectivePath.slice(0, 40),
    };
    return runTransformer(compiled, rawValue, item, resolvedContext);
  }
  return getValueByPath(item, effectivePath);
}

export function applyTransformIfNeeded(sourceMapping: string, rawValue: string): string {
  if (!isTransformer(sourceMapping)) return rawValue;
  const compiled = compileTransformer(sourceMapping);
  if (!compiled) return rawValue;
  const result = runTransformer(compiled, rawValue, {});
  return result != null ? String(result) : rawValue;
}
