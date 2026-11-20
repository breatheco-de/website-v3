/**
 * Per-page pending funnel suggestion: `{type}/{slug}/_funnel_suggestion.yml`.
 * Not a draft/proposal — staff Accept writes live `_common.yml` funnel.
 */

import fs from "fs";
import path from "path";
import yaml from "js-yaml";
import {
  isFunnelStage,
  normalizeFunnelBlock,
  normalizeFunnelProducts,
  type FunnelBlock,
  type FunnelProductBinding,
  type FunnelStage,
} from "@shared/funnel";
import { getFolder } from "./content-types";
import { getDefaultContentRoot } from "./site-config";
import { markFileAsModified } from "./sync-state";
import { dumpContentYaml } from "./content-yaml";
import {
  funnelBlockSnapshot,
  funnelBlocksEqual,
  type FunnelClassifyConfidence,
} from "./ai/decisions/catalog";

export const FUNNEL_SUGGESTION_FILENAME = "_funnel_suggestion.yml";

export type FunnelSuggestionDoc = {
  stage: FunnelStage;
  products: FunnelProductBinding[] | "all";
  confidence: FunnelClassifyConfidence;
  model: string;
  decision_id: string;
  prompt_snapshot?: { state: Record<string, unknown>; questions: Record<string, unknown> };
  based_on_funnel: FunnelBlock;
  created_at: string;
  created_by: string;
};

function contentRootAbs(contentRoot?: string): string {
  const raw = contentRoot ?? getDefaultContentRoot();
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export function funnelSuggestionPath(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string {
  return path.join(
    contentRootAbs(contentRoot),
    getFolder(contentType, contentRoot),
    slug,
    FUNNEL_SUGGESTION_FILENAME,
  );
}

/** Site-prefixed relative path for sync / GitHub (e.g. site_x/blog/slug/_funnel_suggestion.yml). */
export function funnelSuggestionRelPath(
  contentType: string,
  slug: string,
  contentRoot?: string,
): string {
  const root = contentRoot ?? getDefaultContentRoot();
  const abs = funnelSuggestionPath(contentType, slug, contentRoot);
  const cwd = process.cwd();
  if (abs.startsWith(cwd + path.sep)) {
    return abs.slice(cwd.length + 1).split(path.sep).join("/");
  }
  const folder = getFolder(contentType, contentRoot);
  return `${root.replace(/\/$/, "")}/${folder}/${slug}/${FUNNEL_SUGGESTION_FILENAME}`;
}

export function parseFunnelSuggestionDoc(raw: unknown): FunnelSuggestionDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isFunnelStage(typeof o.stage === "string" ? o.stage.trim() : "")) return null;
  const products = normalizeFunnelProducts(o.products);
  if (products == null) return null;
  if (products !== "all" && (!Array.isArray(products) || products.length === 0)) return null;

  const confidenceRaw = o.confidence;
  const confidence: FunnelClassifyConfidence = {
    stage: 0,
    bindings: [],
  };
  if (confidenceRaw && typeof confidenceRaw === "object" && !Array.isArray(confidenceRaw)) {
    const c = confidenceRaw as Record<string, unknown>;
    if (typeof c.stage === "number") confidence.stage = c.stage;
    if (typeof c.products_all === "number") confidence.products_all = c.products_all;
    if (Array.isArray(c.bindings)) {
      for (const b of c.bindings) {
        if (!b || typeof b !== "object") continue;
        const row = b as Record<string, unknown>;
        const product = typeof row.product === "string" ? row.product.trim() : "";
        if (!product) continue;
        const persona =
          typeof row.persona === "string" && row.persona.trim() ? row.persona.trim() : undefined;
        const score = typeof row.score === "number" ? row.score : 0;
        confidence.bindings.push(persona ? { product, persona, score } : { product, score });
      }
    }
  }

  const based = normalizeFunnelBlock(o.based_on_funnel);
  const created_at = typeof o.created_at === "string" ? o.created_at : "";
  const created_by = typeof o.created_by === "string" ? o.created_by : "";
  const model = typeof o.model === "string" ? o.model : "";
  const decision_id = typeof o.decision_id === "string" ? o.decision_id : "funnel.classify";

  const doc: FunnelSuggestionDoc = {
    stage: o.stage as FunnelStage,
    products,
    confidence,
    model,
    decision_id,
    based_on_funnel: funnelBlockSnapshot(based),
    created_at: created_at || new Date().toISOString(),
    created_by: created_by || "staff",
  };
  if (o.prompt_snapshot && typeof o.prompt_snapshot === "object" && !Array.isArray(o.prompt_snapshot)) {
    doc.prompt_snapshot = o.prompt_snapshot as FunnelSuggestionDoc["prompt_snapshot"];
  }
  return doc;
}

export function readFunnelSuggestion(
  contentType: string,
  slug: string,
  contentRoot?: string,
): FunnelSuggestionDoc | null {
  const filePath = funnelSuggestionPath(contentType, slug, contentRoot);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = yaml.load(fs.readFileSync(filePath, "utf-8"));
    return parseFunnelSuggestionDoc(parsed);
  } catch {
    return null;
  }
}

export function writeFunnelSuggestion(
  contentType: string,
  slug: string,
  doc: FunnelSuggestionDoc,
  contentRoot?: string,
  author?: string,
): { relativePath: string; filePath: string } {
  const filePath = funnelSuggestionPath(contentType, slug, contentRoot);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body: Record<string, unknown> = {
    stage: doc.stage,
    products: doc.products,
    confidence: doc.confidence,
    model: doc.model,
    decision_id: doc.decision_id,
    based_on_funnel: funnelBlockSnapshot(doc.based_on_funnel),
    created_at: doc.created_at,
    created_by: doc.created_by,
  };
  if (doc.prompt_snapshot) body.prompt_snapshot = doc.prompt_snapshot;
  fs.writeFileSync(filePath, dumpContentYaml(body, { lineWidth: -1, noRefs: true }), "utf-8");
  const relativePath = funnelSuggestionRelPath(contentType, slug, contentRoot);
  markFileAsModified(relativePath, author ?? doc.created_by, undefined, contentRoot);
  return { relativePath, filePath };
}

export function deleteFunnelSuggestion(
  contentType: string,
  slug: string,
  contentRoot?: string,
  author?: string,
): { deleted: boolean; relativePath: string } {
  const filePath = funnelSuggestionPath(contentType, slug, contentRoot);
  const relativePath = funnelSuggestionRelPath(contentType, slug, contentRoot);
  if (!fs.existsSync(filePath)) {
    return { deleted: false, relativePath };
  }
  fs.unlinkSync(filePath);
  markFileAsModified(relativePath, author ?? "staff", undefined, contentRoot);
  return { deleted: true, relativePath };
}

export function suggestedFunnelFromDoc(doc: FunnelSuggestionDoc): FunnelBlock {
  return funnelBlockSnapshot({ stage: doc.stage, products: doc.products });
}

/** True when live funnel no longer matches what was recorded at propose time. */
export function isFunnelSuggestionStale(
  doc: FunnelSuggestionDoc,
  liveFunnel: FunnelBlock,
): boolean {
  return !funnelBlocksEqual(doc.based_on_funnel, funnelBlockSnapshot(liveFunnel));
}

export function suggestionListPayload(doc: FunnelSuggestionDoc): {
  stage: FunnelStage;
  products: FunnelProductBinding[] | "all";
  confidence: FunnelClassifyConfidence;
  model: string;
  created_at: string;
  created_by: string;
} {
  return {
    stage: doc.stage,
    products: doc.products,
    confidence: doc.confidence,
    model: doc.model,
    created_at: doc.created_at,
    created_by: doc.created_by,
  };
}

export {
  funnelBlocksEqual,
  funnelBlockSnapshot,
};
