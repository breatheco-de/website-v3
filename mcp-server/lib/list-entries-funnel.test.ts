import { describe, expect, it } from "vitest";
import type { FunnelBlock } from "@shared/funnel";
import {
  assertFunnelFilterConflict,
  enrichFunnelFields,
  hasAnyFunnelFilter,
  pageMatchesFunnelFilters,
} from "./list-entries-funnel";

describe("assertFunnelFilterConflict", () => {
  it("allows money+decision and false+awareness", () => {
    expect(assertFunnelFilterConflict({ is_money_page: true, funnel_stage: "decision" }).ok).toBe(
      true,
    );
    expect(
      assertFunnelFilterConflict({ is_money_page: false, funnel_stage: "awareness" }).ok,
    ).toBe(true);
  });

  it("rejects money+consideration and false+decision", () => {
    const a = assertFunnelFilterConflict({
      is_money_page: true,
      funnel_stage: "consideration",
    });
    expect(a.ok).toBe(false);
    if (!a.ok) expect(a.code).toBe("funnel_filter_conflict");

    const b = assertFunnelFilterConflict({ is_money_page: false, funnel_stage: "decision" });
    expect(b.ok).toBe(false);
  });

  it("allows either filter alone", () => {
    expect(assertFunnelFilterConflict({ is_money_page: true }).ok).toBe(true);
    expect(assertFunnelFilterConflict({ funnel_stage: "consideration" }).ok).toBe(true);
  });
});

describe("hasAnyFunnelFilter", () => {
  it("detects any of the three", () => {
    expect(hasAnyFunnelFilter({})).toBe(false);
    expect(hasAnyFunnelFilter({ funnel_stage: "decision" })).toBe(true);
    expect(hasAnyFunnelFilter({ funnel_product: "ai-fluency" })).toBe(true);
    expect(hasAnyFunnelFilter({ is_money_page: false })).toBe(true);
  });
});

describe("pageMatchesFunnelFilters", () => {
  const programCtx = { contentType: "program", contentSlug: "ai-fluency" };
  const blogCtx = { contentType: "blog", contentSlug: "how-much-bootcamp" };

  it("matches is_money_page against decision only", () => {
    const decision: FunnelBlock = { stage: "decision", products: ["ai-fluency"] };
    const consider: FunnelBlock = { stage: "consideration" };
    const empty: FunnelBlock = {};

    expect(pageMatchesFunnelFilters(decision, { is_money_page: true }, programCtx)).toBe(true);
    expect(pageMatchesFunnelFilters(consider, { is_money_page: true }, programCtx)).toBe(false);
    expect(pageMatchesFunnelFilters(empty, { is_money_page: true }, programCtx)).toBe(false);
    expect(pageMatchesFunnelFilters(empty, { is_money_page: false }, programCtx)).toBe(true);
    expect(pageMatchesFunnelFilters(consider, { is_money_page: false }, programCtx)).toBe(true);
  });

  it("matches funnel_stage exactly", () => {
    const block: FunnelBlock = { stage: "consideration" };
    expect(pageMatchesFunnelFilters(block, { funnel_stage: "consideration" }, blogCtx)).toBe(true);
    expect(pageMatchesFunnelFilters(block, { funnel_stage: "decision" }, blogCtx)).toBe(false);
  });

  it("uses effective products so program includes self without products list", () => {
    const bareProgram: FunnelBlock = { stage: "decision" };
    expect(
      pageMatchesFunnelFilters(bareProgram, { funnel_product: "ai-fluency" }, programCtx),
    ).toBe(true);
    expect(
      pageMatchesFunnelFilters(bareProgram, { funnel_product: "other-sku" }, programCtx),
    ).toBe(false);
  });

  it("matches products all and explicit list on non-program", () => {
    expect(
      pageMatchesFunnelFilters(
        { stage: "consideration", products: "all" },
        { funnel_product: "ai-fluency" },
        blogCtx,
      ),
    ).toBe(true);
    expect(
      pageMatchesFunnelFilters(
        { stage: "consideration", products: ["ai-fluency"] },
        { funnel_product: "ai-fluency" },
        blogCtx,
      ),
    ).toBe(true);
    expect(
      pageMatchesFunnelFilters(
        { stage: "consideration", products: ["other"] },
        { funnel_product: "ai-fluency" },
        blogCtx,
      ),
    ).toBe(false);
    expect(
      pageMatchesFunnelFilters({}, { funnel_product: "ai-fluency" }, blogCtx),
    ).toBe(false);
  });

  it("allows product-only match when stage is missing", () => {
    const noStage: FunnelBlock = { products: ["ai-fluency"] };
    expect(
      pageMatchesFunnelFilters(noStage, { funnel_product: "ai-fluency" }, blogCtx),
    ).toBe(true);
  });
});

describe("enrichFunnelFields", () => {
  it("sets is_money_page and stage_missing", () => {
    expect(
      enrichFunnelFields({ stage: "decision" }, { contentType: "program", contentSlug: "x" }),
    ).toEqual({
      funnel: { stage: "decision" },
      is_money_page: true,
      stage_missing: false,
    });
    expect(
      enrichFunnelFields({ products: ["x"] }, { contentType: "blog", contentSlug: "y" }),
    ).toMatchObject({ is_money_page: false, stage_missing: true });
  });
});
