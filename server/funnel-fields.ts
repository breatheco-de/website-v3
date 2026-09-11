/**
 * Page-level `funnel:` on `{slug}/_common.yml` — surgical read/write.
 */

import yaml from "js-yaml";
import * as fs from "fs";
import * as path from "path";
import {
  FUNNEL_YAML_KEY,
  type FunnelBlock,
  type FunnelProducts,
  type FunnelStage,
  isFunnelStage,
  normalizeFunnelBlock,
  normalizeFunnelProducts,
} from "@shared/funnel";
import { findTopLevelKeySpan, surgicalRemoveTopLevelKey } from "./seo-fields";
import { getFolder } from "./content-types";
import { getDefaultContentRoot } from "./site-config";

export { FUNNEL_YAML_KEY };
export type { FunnelBlock, FunnelProducts, FunnelStage };

export type FunnelSaveWarning = {
  code: string;
  message: string;
};

export type FunnelSaveResult =
  | { ok: true; coerced: FunnelBlock; warnings: FunnelSaveWarning[] }
  | { ok: false; error: string; code: string; details?: unknown };

/** Path-touched patch: omit a key to leave it; null / reset clears it. */
export type FunnelMergePatch = {
  /** undefined = leave; null | "" = clear; string = set */
  stage?: unknown;
  /** true when stage was explicitly provided (including null clear) */
  touchStage?: boolean;
  /** undefined = leave; null = clear; "all" | array = set */
  products?: unknown;
  /** true when products was explicitly provided (including null clear) */
  touchProducts?: boolean;
};

export type FunnelFieldUpdate = {
  field_path: string;
  value?: unknown;
  reset?: boolean;
};

function contentRootAbs(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function commonYmlPath(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string {
  return path.join(contentRootAbs(contentRoot), getFolder(contentType, contentRoot), slug, "_common.yml");
}

export function readFunnelBlockFromYamlText(content: string): FunnelBlock {
  const span = findTopLevelKeySpan(content, FUNNEL_YAML_KEY);
  if (!span) return {};
  const chunk = content.slice(span.start, span.end);
  try {
    const parsed = yaml.load(chunk) as { funnel?: FunnelBlock } | null;
    const funnel = parsed?.funnel;
    if (!funnel || typeof funnel !== "object" || Array.isArray(funnel)) return {};
    return normalizeFunnelBlock(funnel);
  } catch {
    return {};
  }
}

export function readFunnelBlockFromFile(filePath: string): FunnelBlock {
  if (!fs.existsSync(filePath)) return {};
  return readFunnelBlockFromYamlText(fs.readFileSync(filePath, "utf-8"));
}

function dumpFunnelBlock(funnel: FunnelBlock): string {
  const cleaned: Record<string, unknown> = {};
  if (funnel.stage !== undefined && funnel.stage !== null && funnel.stage !== "") {
    cleaned.stage = funnel.stage;
  }
  if (funnel.products === "all") {
    cleaned.products = "all";
  } else if (Array.isArray(funnel.products) && funnel.products.length > 0) {
    // Always dump object bindings (not bare strings)
    cleaned.products = funnel.products.map((b) =>
      b.persona ? { product: b.product, persona: b.persona } : { product: b.product },
    );
  }
  if (Object.keys(cleaned).length === 0) return "";
  return yaml
    .dump(
      { [FUNNEL_YAML_KEY]: cleaned },
      { lineWidth: -1, noRefs: true, quotingType: '"', forceQuotes: false },
    )
    .trimEnd();
}

/** Replace or insert top-level `funnel:` without dumping the rest of the file. */
export function surgicalReplaceFunnelBlock(content: string, funnel: FunnelBlock): string {
  const dumped = dumpFunnelBlock(funnel);
  const span = findTopLevelKeySpan(content, FUNNEL_YAML_KEY);
  if (!dumped) {
    if (!span) return content;
    return surgicalRemoveTopLevelKey(content, FUNNEL_YAML_KEY);
  }
  if (!span) {
    const trimmed = content.endsWith("\n") ? content : `${content}\n`;
    return `${trimmed}${dumped}\n`;
  }
  const before = content.slice(0, span.start);
  let after = content.slice(span.end);
  if (after.startsWith("\n")) after = after.slice(1);
  const mid = dumped.endsWith("\n") ? dumped : `${dumped}\n`;
  return `${before}${mid}${after}`;
}

/**
 * Coerce a full replace payload (no merge). Prefer {@link mergeFunnelPatch} for path-touched writes.
 */
export function coerceFunnelInput(raw: {
  stage?: unknown;
  products?: unknown;
}): FunnelSaveResult {
  return mergeFunnelPatch(
    {},
    {
      touchStage: raw.stage !== undefined,
      stage: raw.stage,
      touchProducts: raw.products !== undefined,
      products: raw.products,
    },
  );
}

/**
 * Merge path-touched funnel fields onto `current`. Untouched keys are preserved.
 * - stage: touch + null/"" → clear; touch + string → set
 * - products: touch + null → clear; touch + "all"|array → set; empty array → clear
 */
export function mergeFunnelPatch(current: FunnelBlock, patch: FunnelMergePatch): FunnelSaveResult {
  const warnings: FunnelSaveWarning[] = [];
  const out: FunnelBlock = { ...normalizeFunnelBlock(current) };

  if (patch.touchStage) {
    if (patch.stage === undefined || patch.stage === null || patch.stage === "") {
      delete out.stage;
    } else {
      const s = String(patch.stage).trim();
      if (!isFunnelStage(s)) {
        return {
          ok: false,
          code: "invalid_stage",
          error: `Invalid funnel.stage "${s}". Valid: awareness, consideration, decision, post-enrollment`,
        };
      }
      out.stage = s;
    }
  }

  if (patch.touchProducts) {
    if (patch.products === null || patch.products === undefined) {
      delete out.products;
    } else if (patch.products === "all") {
      out.products = "all";
    } else if (Array.isArray(patch.products)) {
      const normalized = normalizeFunnelProducts(patch.products);
      if (normalized && normalized !== "all") out.products = normalized;
      else delete out.products;
    } else {
      return {
        ok: false,
        code: "invalid_products",
        error: 'funnel.products must be "all" or a list of product slugs / { product, persona? } bindings',
      };
    }
  }

  const products = normalizeFunnelProducts(out.products);
  const hasProducts = products === "all" || (Array.isArray(products) && products.length > 0);
  if (hasProducts && !out.stage) {
    warnings.push({
      code: "products_without_stage",
      message:
        "funnel.products is set but funnel.stage is missing. Store will hide this page until stage is set.",
    });
  }

  return { ok: true, coerced: normalizeFunnelBlock(out), warnings };
}

/**
 * Apply MCP-style field updates (`funnel.stage` / `funnel.products`, optional reset).
 */
export function applyFunnelFieldUpdates(
  current: FunnelBlock,
  updates: FunnelFieldUpdate[],
): FunnelSaveResult {
  const patch: FunnelMergePatch = {};
  for (const u of updates) {
    const p = u.field_path;
    if (p !== "funnel.stage" && p !== "funnel.products" && p !== "funnel") {
      return {
        ok: false,
        code: "invalid_funnel_path",
        error: `Unsupported funnel path '${p}'. Use funnel.stage or funnel.products.`,
      };
    }
    if (p === "funnel") {
      if (u.reset) {
        patch.touchStage = true;
        patch.stage = null;
        patch.touchProducts = true;
        patch.products = null;
        continue;
      }
      if (!u.value || typeof u.value !== "object" || Array.isArray(u.value)) {
        return {
          ok: false,
          code: "invalid_funnel_block",
          error: "funnel value must be an object with optional stage and products",
        };
      }
      const block = u.value as Record<string, unknown>;
      if ("stage" in block) {
        patch.touchStage = true;
        patch.stage = block.stage;
      }
      if ("products" in block) {
        patch.touchProducts = true;
        patch.products = block.products;
      }
      continue;
    }
    if (p === "funnel.stage") {
      patch.touchStage = true;
      patch.stage = u.reset ? null : u.value;
    } else {
      patch.touchProducts = true;
      patch.products = u.reset ? null : u.value;
    }
  }
  if (!patch.touchStage && !patch.touchProducts) {
    return { ok: true, coerced: normalizeFunnelBlock(current), warnings: [] };
  }
  return mergeFunnelPatch(current, patch);
}

export function isFunnelFieldPath(path: string): boolean {
  return path === "funnel" || path === "funnel.stage" || path === "funnel.products";
}

export function writeFunnelBlock(
  contentType: string,
  slug: string,
  funnel: FunnelBlock,
  contentRoot?: string,
): { relativePath: string; filePath: string } {
  const filePath = commonYmlPath(contentType, slug, contentRoot);
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : "";
  const next = surgicalReplaceFunnelBlock(existing, funnel);
  fs.writeFileSync(filePath, next, "utf-8");
  const root = contentRootAbs(contentRoot);
  const relativePath = path.relative(root, filePath).split(path.sep).join("/");
  return { relativePath, filePath };
}

export function clearFunnelBlock(contentType: string, slug: string, contentRoot?: string): void {
  const filePath = commonYmlPath(contentType, slug, contentRoot);
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  fs.writeFileSync(filePath, surgicalRemoveTopLevelKey(content, FUNNEL_YAML_KEY), "utf-8");
}

export function isFunnelBlockEmpty(funnel: FunnelBlock): boolean {
  const hasStage = typeof funnel.stage === "string" && funnel.stage.trim().length > 0;
  const products = normalizeFunnelProducts(funnel.products as unknown);
  const hasProducts = products === "all" || (Array.isArray(products) && products.length > 0);
  return !hasStage && !hasProducts;
}

/**
 * Read-merge-write funnel for one entry. Returns merged block or gate/coerce error.
 */
export function prepareAndWriteFunnelMerge(
  contentType: string,
  slug: string,
  patch: FunnelMergePatch,
  contentRoot: string | undefined,
  assertGates: (
    funnel: FunnelBlock,
    ctx: { contentType: string; contentSlug: string },
  ) => { ok: true; warnings: { code: string; message: string }[] } | { ok: false; error: string; code: string; details?: unknown },
): (FunnelSaveResult & { relativePath?: string }) {
  const filePath = commonYmlPath(contentType, slug, contentRoot);
  const current = readFunnelBlockFromFile(filePath);
  const merged = mergeFunnelPatch(current, patch);
  if (!merged.ok) return merged;

  const gates = assertGates(merged.coerced, { contentType, contentSlug: slug });
  if (!gates.ok) {
    return { ok: false, error: gates.error, code: gates.code, details: gates.details };
  }

  if (isFunnelBlockEmpty(merged.coerced)) {
    clearFunnelBlock(contentType, slug, contentRoot);
    const root = contentRootAbs(contentRoot);
    const relativePath = path.relative(root, filePath).split(path.sep).join("/");
    return {
      ok: true,
      coerced: {},
      warnings: [...merged.warnings, ...gates.warnings],
      relativePath,
    };
  }

  const { relativePath } = writeFunnelBlock(contentType, slug, merged.coerced, contentRoot);
  return {
    ok: true,
    coerced: merged.coerced,
    warnings: [...merged.warnings, ...gates.warnings],
    relativePath,
  };
}
