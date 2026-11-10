/**
 * Public bundle guard: which JS every anonymous visitor downloads before any
 * section component loads. That is the static-import closure of the client
 * entry plus the three public page chunks. Admin-only libraries found there
 * fail the build; libraries we still plan to move out only warn.
 */

export interface BundleChunk {
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  /** Static imports only (dynamic imports load on demand). */
  imports: string[];
  moduleIds: string[];
  sizeBytes: number;
}

export interface ModuleRule {
  label: string;
  pattern: RegExp;
}

export interface ClosureHit {
  label: string;
  chunk: string;
  /** First matching module in the chunk, plus how many more matched. */
  module: string;
  moreModules: number;
  /** Modules in the same chunk that do not match the rule: usually the shared code public chunks actually import. */
  otherModules: string[];
  /** Import chain from a root chunk to `chunk`, root first. */
  via: string[];
}

export interface PublicClosureReport {
  roots: string[];
  files: string[];
  rawBytes: number;
  errors: ClosureHit[];
  warnings: ClosureHit[];
}

export const PUBLIC_PAGE_MODULE_RE =
  /[\\/]client[\\/]src[\\/]pages[\\/](page|ContentTypeDetail|DatabaseSinglePage)\.tsx$/;

export const FORBIDDEN_IN_PUBLIC: ModuleRule[] = [
  { label: "Recharts", pattern: /[\\/]node_modules[\\/](recharts|victory-vendor)[\\/]/ },
  { label: "framer-motion", pattern: /[\\/]node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/ },
];

/** Still public today (audit item 6); warn until they move behind edit mode. */
export const WARN_IN_PUBLIC: ModuleRule[] = [
  { label: "CodeMirror", pattern: /[\\/]node_modules[\\/]@codemirror[\\/]/ },
  { label: "dnd-kit", pattern: /[\\/]node_modules[\\/]@dnd-kit[\\/]/ },
];

function hitsFor(
  rules: ModuleRule[],
  chunk: BundleChunk,
  via: string[],
): ClosureHit[] {
  const hits: ClosureHit[] = [];
  for (const rule of rules) {
    const matched = chunk.moduleIds.filter((id) => rule.pattern.test(id));
    if (matched.length === 0) continue;
    hits.push({
      label: rule.label,
      chunk: chunk.fileName,
      module: matched[0]!,
      moreModules: matched.length - 1,
      otherModules: chunk.moduleIds.filter((id) => !rule.pattern.test(id)),
      via,
    });
  }
  return hits;
}

export function checkPublicClosure(
  chunks: BundleChunk[],
  rules: { forbidden?: ModuleRule[]; warn?: ModuleRule[] } = {},
): PublicClosureReport {
  const forbidden = rules.forbidden ?? FORBIDDEN_IN_PUBLIC;
  const warn = rules.warn ?? WARN_IN_PUBLIC;
  const byFile = new Map(chunks.map((c) => [c.fileName, c]));
  const roots = chunks
    .filter((c) => c.isEntry || (c.facadeModuleId != null && PUBLIC_PAGE_MODULE_RE.test(c.facadeModuleId)))
    .map((c) => c.fileName);

  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const root of roots) {
    parent.set(root, null);
    queue.push(root);
  }
  while (queue.length > 0) {
    const file = queue.shift()!;
    for (const dep of byFile.get(file)?.imports ?? []) {
      if (parent.has(dep) || !byFile.has(dep)) continue;
      parent.set(dep, file);
      queue.push(dep);
    }
  }

  const chainTo = (file: string): string[] => {
    const chain: string[] = [];
    for (let cur: string | null = file; cur != null; cur = parent.get(cur) ?? null) chain.unshift(cur);
    return chain;
  };

  const files = Array.from(parent.keys());
  let rawBytes = 0;
  const errors: ClosureHit[] = [];
  const warnings: ClosureHit[] = [];
  for (const file of files) {
    const chunk = byFile.get(file)!;
    rawBytes += chunk.sizeBytes;
    const via = chainTo(file);
    errors.push(...hitsFor(forbidden, chunk, via));
    warnings.push(...hitsFor(warn, chunk, via));
  }
  return { roots, files, rawBytes, errors, warnings };
}

export function formatHit(hit: ClosureHit): string {
  const more = hit.moreModules > 0 ? ` (+${hit.moreModules} more)` : "";
  const shown = hit.otherModules.slice(0, 8);
  const others =
    shown.length > 0
      ? `\n    other modules in that chunk: ${shown.join(", ")}${hit.otherModules.length > shown.length ? ", ..." : ""}`
      : "";
  return `${hit.label} in ${hit.chunk}: ${hit.module}${more}\n    reached via ${hit.via.join(" -> ")}${others}`;
}
