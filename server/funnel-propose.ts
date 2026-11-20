/**
 * Staff bulk Propose funnel: Jev classify → `_funnel_suggestion.yml` (or already_correct).
 */

import type { FunnelBlock } from "@shared/funnel";
import {
  askFunnelClassification,
  DECISION_ID_FUNNEL_CLASSIFICATION,
  funnelBlockSnapshot,
  funnelBlocksEqual,
  getDecisionClient,
  type FunnelClassifyProduct,
} from "./ai/decisions";
import { buildFunnelClassifySnippet, isFunnelSnippetTooThin } from "./funnel-classify-snippet";
import { commonYmlPath, readFunnelBlockFromFile } from "./funnel-fields";
import {
  deleteFunnelSuggestion,
  readFunnelSuggestion,
  suggestedFunnelFromDoc,
  writeFunnelSuggestion,
  type FunnelSuggestionDoc,
} from "./funnel-suggestion";
import { productPersonasForFunnel } from "./product/funnel-audience-gates";
import { listProductRows } from "./product/product-io";
import { ContentIndex } from "./content-index";
import type { ContentType } from "@shared/schema";

export const FUNNEL_PROPOSE_MAX_SLUGS = 40;

export type FunnelProposeOk = {
  slug: string;
  outcome: "suggested" | "already_correct" | "replaced";
};

export type FunnelProposeFailed = {
  slug: string;
  error: string;
  code?: string;
};

function loadProductCatalog(contentRoot?: string): FunnelClassifyProduct[] {
  return listProductRows({ includePaused: true, contentRoot }).map((row) => {
    const fromGate = productPersonasForFunnel(row.content_slug);
    const personas =
      fromGate ??
      (row.personas ?? []).map((p) => ({
        id: p.id,
        label: p.label || p.id,
        role: p.label || p.id,
      }));
    return {
      slug: row.content_slug,
      name: row.name,
      personas,
    };
  });
}

function pickLocale(ci: ContentIndex, contentType: string, slug: string): string {
  try {
    const locales = [
      ...ci.getAvailableLocalesOrVariants(contentType as ContentType, slug),
    ].sort();
    if (locales.length > 0) {
      if (locales.includes("en")) return "en";
      return locales[0]!;
    }
  } catch {
    /* fall through */
  }
  return "en";
}

/**
 * Classify one page. Best-effort; does not throw for Jev/business failures.
 */
export async function proposeFunnelForSlug(opts: {
  contentType: string;
  slug: string;
  contentRoot: string;
  contentIndex: ContentIndex;
  author: string;
  catalog?: FunnelClassifyProduct[];
}): Promise<{ ok: FunnelProposeOk } | { failed: FunnelProposeFailed }> {
  const { contentType, slug, contentRoot, contentIndex: ci, author } = opts;
  const catalog = opts.catalog ?? loadProductCatalog(contentRoot);

  const locale = pickLocale(ci, contentType, slug);
  const merged = ci.loadMergedContent(contentType, slug, locale);
  const data = (merged?.data ?? null) as Record<string, unknown> | null;
  const snippet = buildFunnelClassifySnippet(data);
  if (isFunnelSnippetTooThin(snippet)) {
    return {
      failed: {
        slug,
        error: "Not enough page copy (title, hero, CTAs) to classify.",
        code: "not_enough_page_copy",
      },
    };
  }

  if (catalog.length === 0) {
    return {
      failed: {
        slug,
        error: "No products available to classify against.",
        code: "no_products",
      },
    };
  }

  const result = await askFunnelClassification(getDecisionClient(), {
    page_snippet: snippet,
    products: catalog,
  });

  if (result.outcome === "unavailable") {
    return {
      failed: {
        slug,
        error: "Decision model unavailable — try again.",
        code: "jev_unavailable",
      },
    };
  }
  if (result.outcome === "unclear") {
    return {
      failed: {
        slug,
        error: result.message,
        code: "unclear_classification",
      },
    };
  }

  const livePath = commonYmlPath(contentType, slug, contentRoot);
  const live = readFunnelBlockFromFile(livePath);
  const suggested: FunnelBlock = {
    stage: result.stage,
    products: result.products,
  };

  if (funnelBlocksEqual(suggested, funnelBlockSnapshot(live))) {
    const cleared = deleteFunnelSuggestion(contentType, slug, contentRoot, author);
    return {
      ok: {
        slug,
        outcome: "already_correct",
        ...(cleared.deleted ? {} : {}),
      },
    };
  }

  const hadExisting = !!readFunnelSuggestion(contentType, slug, contentRoot);
  const doc: FunnelSuggestionDoc = {
    stage: result.stage,
    products: result.products,
    confidence: result.confidence,
    model: result.model,
    decision_id: DECISION_ID_FUNNEL_CLASSIFICATION,
    prompt_snapshot: result.prompt_snapshot,
    based_on_funnel: funnelBlockSnapshot(live),
    created_at: new Date().toISOString(),
    created_by: author,
  };
  writeFunnelSuggestion(contentType, slug, doc, contentRoot, author);
  return {
    ok: {
      slug,
      outcome: hadExisting ? "replaced" : "suggested",
    },
  };
}

export async function proposeFunnelForSlugs(opts: {
  contentType: string;
  slugs: string[];
  contentRoot: string;
  contentIndex: ContentIndex;
  author: string;
}): Promise<{ ok: FunnelProposeOk[]; failed: FunnelProposeFailed[] }> {
  const slugs = [...new Set(opts.slugs.map((s) => s.trim()).filter(Boolean))].slice(
    0,
    FUNNEL_PROPOSE_MAX_SLUGS,
  );
  const catalog = loadProductCatalog(opts.contentRoot);
  const ok: FunnelProposeOk[] = [];
  const failed: FunnelProposeFailed[] = [];
  for (const slug of slugs) {
    const r = await proposeFunnelForSlug({
      ...opts,
      slug,
      catalog,
    });
    if ("ok" in r) ok.push(r.ok);
    else failed.push(r.failed);
  }
  return { ok, failed };
}

export { suggestedFunnelFromDoc };
