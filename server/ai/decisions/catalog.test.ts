import { afterEach, describe, expect, it, vi } from "vitest";
import {
  askTouchesOutcomeFigures,
  askTouchesSiteFacts,
  askFunnelClassification,
  funnelBlocksEqual,
  FUNNEL_CLASSIFY_NOUL_THRESHOLD,
  SITE_FACT_QUESTION_CATEGORIES,
  TOUCHES_SITE_FACTS_NOUL_THRESHOLD,
  TOUCHES_OUTCOME_FIGURES_NOUL_THRESHOLD,
  type DecisionClient,
} from "./index";
import { probeDecisionModel } from "./openrouter-jev";

describe("askTouchesOutcomeFigures", () => {
  it("returns yes above threshold", async () => {
    const client: DecisionClient = {
      async decide() {
        return {
          status: "ok",
          model: "test",
          answers: {
            touches_outcome_figures: { noul: TOUCHES_OUTCOME_FIGURES_NOUL_THRESHOLD },
          },
        };
      },
    };
    const r = await askTouchesOutcomeFigures(client, "salary $80k");
    expect(r.outcome).toBe("yes");
  });

  it("returns no below threshold", async () => {
    const client: DecisionClient = {
      async decide() {
        return {
          status: "ok",
          model: "test",
          answers: { touches_outcome_figures: { noul: 0.1 } },
        };
      },
    };
    const r = await askTouchesOutcomeFigures(client, "50% of chapter");
    expect(r.outcome).toBe("no");
  });

  it("returns unavailable on client failure", async () => {
    const client: DecisionClient = {
      async decide() {
        return { status: "unavailable", reason: "no_key" };
      },
    };
    const r = await askTouchesOutcomeFigures(client, "x");
    expect(r.outcome).toBe("unavailable");
  });

  it("omits model so client uses resolveDecisionModel default", async () => {
    const client: DecisionClient = {
      async decide(req) {
        expect(req.model).toBeUndefined();
        return {
          status: "ok",
          model: "~typesafe/jev-latest",
          answers: { touches_outcome_figures: { noul: 0.9 } },
        };
      },
    };
    const r = await askTouchesOutcomeFigures(client, "hire rate 90%");
    expect(r.outcome).toBe("yes");
  });
});

describe("probeDecisionModel", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns ok when decisions API answers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          answers: { reachable: { noul: 0.9 } },
          model: "typesafe/jev-1.13",
        }),
      })),
    );
    const prev = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-key";
    try {
      const r = await probeDecisionModel({ model: "typesafe/jev-1.13" });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.model).toContain("jev");
    } finally {
      if (prev === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = prev;
    }
  });
});

describe("askTouchesSiteFacts", () => {
  it("asks one noul per fact category and returns categories at/above threshold", async () => {
    const client: DecisionClient = {
      async decide(req) {
        expect(Object.keys(req.questions).sort()).toEqual([...SITE_FACT_QUESTION_CATEGORIES].sort());
        expect(Object.values(req.questions).every((q) => q.type === "noul")).toBe(true);
        return {
          status: "ok",
          model: "test",
          answers: {
            price: { noul: TOUCHES_SITE_FACTS_NOUL_THRESHOLD },
            contact: { noul: 0.9 },
            outcome_claim: { noul: 0.2 },
          },
        };
      },
    };
    const r = await askTouchesSiteFacts(client, "Call (305) 555-0100 — tuition $9,999");
    expect(r.outcome).toBe("ok");
    expect(r.categories).toEqual(["price", "contact"]);
  });

  it("returns unavailable with no categories on client failure", async () => {
    const client: DecisionClient = {
      async decide() {
        return { status: "unavailable", reason: "timeout" };
      },
    };
    const r = await askTouchesSiteFacts(client, "x");
    expect(r).toMatchObject({ outcome: "unavailable", categories: [] });
  });
});

describe("askFunnelClassification", () => {
  const products = [
    {
      slug: "ai-engineering",
      name: "AI Engineering",
      personas: [
        { id: "the-career-changer", label: "Career changer", role: "Non-tech professional" },
        { id: "the-frustrated-graduate", label: "Frustrated graduate", role: "CS graduate" },
      ],
    },
  ];

  it("maps stage choice + persona noul to bindings", async () => {
    const client: DecisionClient = {
      async decide(req) {
        expect(req.questions.stage?.type).toBe("choice");
        expect(req.questions.products_all?.type).toBe("noul");
        expect(req.questions["persona_ai-engineering__the-career-changer"]?.type).toBe("noul");
        return {
          status: "ok",
          model: "jev-test",
          answers: {
            stage: { choice: "awareness", confidence: 0.8 },
            products_all: { noul: 0.1 },
            "persona_ai-engineering__the-career-changer": { noul: FUNNEL_CLASSIFY_NOUL_THRESHOLD },
            "persona_ai-engineering__the-frustrated-graduate": { noul: 0.1 },
          },
        };
      },
    };
    const r = await askFunnelClassification(client, {
      page_snippet: "Career change into AI engineering for non-tech professionals looking for outcomes.",
      products,
    });
    expect(r.outcome).toBe("ok");
    if (r.outcome === "ok") {
      expect(r.stage).toBe("awareness");
      expect(r.products).toEqual([
        { product: "ai-engineering", persona: "the-career-changer" },
      ]);
    }
  });

  it("uses products:all when no persona fits but all scores high", async () => {
    const client: DecisionClient = {
      async decide() {
        return {
          status: "ok",
          model: "jev-test",
          answers: {
            stage: { choice: "awareness" },
            products_all: { noul: 0.9 },
            "persona_ai-engineering__the-career-changer": { noul: 0.1 },
            "persona_ai-engineering__the-frustrated-graduate": { noul: 0.1 },
          },
        };
      },
    };
    const r = await askFunnelClassification(client, {
      page_snippet: "About our company history and campuses worldwide for everyone.",
      products,
    });
    expect(r).toMatchObject({ outcome: "ok", stage: "awareness", products: "all" });
  });

  it("returns unclear when nothing scores", async () => {
    const client: DecisionClient = {
      async decide() {
        return {
          status: "ok",
          model: "jev-test",
          answers: {
            stage: { choice: "consideration" },
            products_all: { noul: 0.1 },
            "persona_ai-engineering__the-career-changer": { noul: 0.1 },
            "persona_ai-engineering__the-frustrated-graduate": { noul: 0.1 },
          },
        };
      },
    };
    const r = await askFunnelClassification(client, {
      page_snippet: "Random cooking tips that do not match any product.",
      products,
    });
    expect(r.outcome).toBe("unclear");
  });

  it("returns unavailable on client failure", async () => {
    const client: DecisionClient = {
      async decide() {
        return { status: "unavailable", reason: "no_key" };
      },
    };
    const r = await askFunnelClassification(client, {
      page_snippet: "Career change into AI long enough to classify.",
      products,
    });
    expect(r.outcome).toBe("unavailable");
  });
});

describe("funnelBlocksEqual", () => {
  it("ignores binding order", () => {
    expect(
      funnelBlocksEqual(
        {
          stage: "awareness",
          products: [
            { product: "a", persona: "p1" },
            { product: "b" },
          ],
        },
        {
          stage: "awareness",
          products: [
            { product: "b" },
            { product: "a", persona: "p1" },
          ],
        },
      ),
    ).toBe(true);
  });
});
