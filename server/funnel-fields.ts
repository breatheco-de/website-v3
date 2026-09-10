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

export function coerceFunnelInput(raw: {
  stage?: unknown;
  products?: unknown;
}): FunnelSaveResult {
  const warnings: FunnelSaveWarning[] = [];
  const out: FunnelBlock = {};

  if (raw.stage !== undefined && raw.stage !== null && raw.stage !== "") {
    const s = String(raw.stage).trim();
    if (!isFunnelStage(s)) {
      return {
        ok: false,
        code: "invalid_stage",
        error: `Invalid funnel.stage "${s}". Valid: awareness, consideration, decision, post-enrollment`,
      };
    }
    out.stage = s;
  }

  if (raw.products === "all") {
    out.products = "all";
  } else if (Array.isArray(raw.products)) {
    const normalized = normalizeFunnelProducts(raw.products);
    if (normalized && normalized !== "all") out.products = normalized;
    else if (raw.products.length === 0) out.products = undefined;
  } else if (raw.products === null || raw.products === undefined) {
    // omit
  } else {
    return {
      ok: false,
      code: "invalid_products",
      error: 'funnel.products must be "all" or a list of product slugs / { product, persona? } bindings',
    };
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
