/**
 * Funnel / money-page filters for MCP list_entries.
 */

import {
  effectiveProducts,
  FUNNEL_STAGES,
  type FunnelBlock,
  type FunnelStage,
  scopeIncludesProduct,
} from "@shared/funnel";

export type ListEntriesFunnelFilters = {
  funnel_stage?: FunnelStage | string;
  funnel_product?: string;
  is_money_page?: boolean;
};

export type FunnelFilterConflict = {
  ok: false;
  error: string;
  code: "funnel_filter_conflict";
};

export type FunnelFilterOk = { ok: true };

export type EnrichedFunnelFields = {
  funnel: FunnelBlock;
  is_money_page: boolean;
  stage_missing: boolean;
};

const MONEY_STAGE: FunnelStage = "decision";

export function hasAnyFunnelFilter(filters: ListEntriesFunnelFilters): boolean {
  return (
    filters.funnel_stage !== undefined ||
    filters.funnel_product !== undefined ||
    filters.is_money_page !== undefined
  );
}

/**
 * Reject conflicting is_money_page + funnel_stage pairs.
 * Redundant pairs (true+decision, false+non-decision) are allowed.
 */
export function assertFunnelFilterConflict(
  filters: ListEntriesFunnelFilters,
): FunnelFilterConflict | FunnelFilterOk {
  const { is_money_page: isMoney, funnel_stage: stage } = filters;
  if (isMoney === undefined || stage === undefined || stage === "") {
    return { ok: true };
  }
  const stageTrim = String(stage).trim();
  if (isMoney === true && stageTrim !== MONEY_STAGE) {
    return {
      ok: false,
      code: "funnel_filter_conflict",
      error: `is_money_page:true conflicts with funnel_stage:"${stageTrim}" (money pages are stage "decision" only).`,
    };
  }
  if (isMoney === false && stageTrim === MONEY_STAGE) {
    return {
      ok: false,
      code: "funnel_filter_conflict",
      error: `is_money_page:false conflicts with funnel_stage:"decision".`,
    };
  }
  return { ok: true };
}

export function normalizedStage(funnel: FunnelBlock | undefined | null): string {
  const s = funnel?.stage;
  return typeof s === "string" && s.trim() ? s.trim() : "";
}

export function isMoneyPageFunnel(funnel: FunnelBlock | undefined | null): boolean {
  return normalizedStage(funnel) === MONEY_STAGE;
}

export function enrichFunnelFields(
  funnel: FunnelBlock,
  ctx: { contentType: string; contentSlug: string },
): EnrichedFunnelFields {
  const stage = normalizedStage(funnel);
  return {
    funnel,
    is_money_page: stage === MONEY_STAGE,
    stage_missing: stage.length === 0,
  };
}

export function pageMatchesFunnelFilters(
  funnel: FunnelBlock,
  filters: ListEntriesFunnelFilters,
  ctx: { contentType: string; contentSlug: string },
): boolean {
  const stage = normalizedStage(funnel);

  if (filters.funnel_stage !== undefined && filters.funnel_stage !== "") {
    if (stage !== String(filters.funnel_stage).trim()) return false;
  }

  if (filters.is_money_page !== undefined) {
    const isMoney = stage === MONEY_STAGE;
    if (isMoney !== filters.is_money_page) return false;
  }

  if (filters.funnel_product !== undefined && filters.funnel_product !== "") {
    const product = filters.funnel_product.trim();
    const effective = effectiveProducts(funnel, {
      contentType: ctx.contentType,
      contentSlug: ctx.contentSlug,
    });
    if (!effective || !scopeIncludesProduct(effective, product)) return false;
  }

  return true;
}

export const LIST_ENTRIES_FUNNEL_STAGES = FUNNEL_STAGES;
