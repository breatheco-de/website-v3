/**
 * Product decision ids + thresholds. Policy lives here; HTTP client stays dumb.
 */

import {
  FUNNEL_STAGES,
  isFunnelStage,
  type FunnelBlock,
  type FunnelProductBinding,
  type FunnelStage,
} from "@shared/funnel";
import type { DecisionClient, DecideResult, DecisionQuestion } from "./types";

export const DECISION_ID_TOUCHES_OUTCOME_FIGURES = "proposal.touches_outcome_figures";

/** Noul above this → treat as yes (figures checklist on). */
export const TOUCHES_OUTCOME_FIGURES_NOUL_THRESHOLD = 0.55;

export type TouchesOutcomeFiguresOutcome = "yes" | "no" | "unavailable";

export async function askTouchesOutcomeFigures(
  client: DecisionClient,
  text: string,
): Promise<{ outcome: TouchesOutcomeFiguresOutcome; raw?: DecideResult }> {
  const truncated = text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text;
  const raw = await client.decide({
    timeoutMs: 2000,
    state: {
      decision_id: DECISION_ID_TOUCHES_OUTCOME_FIGURES,
      proposed_text: truncated,
    },
    questions: {
      touches_outcome_figures: {
        type: "noul",
        instructions:
          "Does this proposed text add or change hire rates, salaries, tuition, prices, or similar outcome figures that a reviewer must verify against an approved source?",
        true: "Adds or changes verifiable outcome figures (hire rate, salary, tuition, price, scholarship amount, placement rate).",
        false:
          "No outcome-figure claims — ordinary copy, educational examples, or unrelated percentages.",
      },
    },
  });

  if (raw.status === "unavailable") {
    return { outcome: "unavailable", raw };
  }

  const ans = raw.answers.touches_outcome_figures as { noul?: number } | undefined;
  const noul = typeof ans?.noul === "number" ? ans.noul : 0;
  return {
    outcome: noul >= TOUCHES_OUTCOME_FIGURES_NOUL_THRESHOLD ? "yes" : "no",
    raw,
  };
}

export const DECISION_ID_NAMES_THIRD_PARTIES = "proposal.names_third_parties";

/** Noul above this → the text presents that name as a relationship with us. */
export const NAMES_THIRD_PARTIES_NOUL_THRESHOLD = 0.55;

/** Candidate names asked per call (one noul question each). */
export const NAMES_THIRD_PARTIES_MAX_CANDIDATES = 10;

export type NamesThirdPartiesOutcome = "ok" | "unavailable";

/**
 * Which candidate names does the text present as having chosen, partnered with, covered, endorsed,
 * ranked or awarded the brand? Mentions of tools, studies, employers in general, or examples are not claims.
 */
export async function askNamesThirdParties(
  client: DecisionClient,
  text: string,
  candidates: string[],
  brand: string,
): Promise<{ outcome: NamesThirdPartiesOutcome; names: string[]; raw?: DecideResult }> {
  const list = candidates.slice(0, NAMES_THIRD_PARTIES_MAX_CANDIDATES);
  if (list.length === 0) return { outcome: "ok", names: [] };
  const truncated = text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text;
  const questions = Object.fromEntries(
    list.map((name, i) => [
      `candidate_${i}`,
      {
        type: "noul" as const,
        instructions:
          `Does this text present "${name}" as having a relationship with ${brand}: chose, selected, hired or contracted ${brand}; ` +
          `partnered or works alongside ${brand} on a program; covered ${brand} in the press; endorsed, ranked, accredited or awarded ${brand}?`,
        true: `"${name}" is claimed as a partner, client, press outlet, endorser, ranker or award giver of ${brand}.`,
        false:
          `"${name}" is only mentioned: a tool or technology, a study or statistic source, an example employer, ` +
          `a place, a topic, or a company the article teaches about — not a claimed relationship with ${brand}.`,
      },
    ]),
  );
  const raw = await client.decide({
    timeoutMs: 2500,
    state: {
      decision_id: DECISION_ID_NAMES_THIRD_PARTIES,
      brand,
      proposed_text: truncated,
      candidates: list,
    },
    questions,
  });

  if (raw.status === "unavailable") {
    return { outcome: "unavailable", names: [], raw };
  }

  const names = list.filter((_, i) => {
    const ans = raw.answers[`candidate_${i}`] as { noul?: number } | undefined;
    return typeof ans?.noul === "number" && ans.noul >= NAMES_THIRD_PARTIES_NOUL_THRESHOLD;
  });
  return { outcome: "ok", names, raw };
}

export const DECISION_ID_TOUCHES_SITE_FACTS = "proposal.touches_site_facts";

/** Noul above this → the proposal touches that fact category. */
export const TOUCHES_SITE_FACTS_NOUL_THRESHOLD = 0.55;

/** Mirrors FACT_CATEGORIES in shared/variable-metadata.ts — one noul question each. */
export const SITE_FACT_QUESTION_CATEGORIES = [
  "price",
  "outcome_claim",
  "social_proof",
  "product_fact",
  "company_fact",
  "contact",
] as const;

export type SiteFactQuestionCategory = (typeof SITE_FACT_QUESTION_CATEGORIES)[number];

const SITE_FACT_QUESTIONS: Record<SiteFactQuestionCategory, { instructions: string; true: string; false: string }> = {
  price: {
    instructions: "Does this text state or change a tuition, price, monthly payment, or financing amount?",
    true: "Mentions a concrete price, tuition, payment plan amount, or financing figure.",
    false: "No prices or payment amounts.",
  },
  outcome_claim: {
    instructions: "Does this text state or change a hire rate, salary, salary increase, or placement outcome?",
    true: "Mentions graduate outcomes such as hire rate, salary, or placement rate.",
    false: "No graduate outcome claims.",
  },
  social_proof: {
    instructions: "Does this text state review counts, ratings, alumni counts, or similar social proof?",
    true: "Mentions ratings, review counts, number of graduates, or rankings.",
    false: "No social-proof numbers.",
  },
  product_fact: {
    instructions: "Does this text state program facts such as duration, schedule, tracks, or eligibility?",
    true: "Mentions how long a program lasts, its schedule, tracks, or who can enroll.",
    false: "No program facts.",
  },
  company_fact: {
    instructions: "Does this text state company facts such as campuses, hiring partners, or scholarships?",
    true: "Mentions campuses, partner companies, scholarships, or company history figures.",
    false: "No company facts.",
  },
  contact: {
    instructions: "Does this text include a phone number, email address, or physical address?",
    true: "Contains contact details (phone, email, street address).",
    false: "No contact details.",
  },
};

export type TouchesSiteFactsOutcome = "ok" | "unavailable";

export async function askTouchesSiteFacts(
  client: DecisionClient,
  text: string,
): Promise<{ outcome: TouchesSiteFactsOutcome; categories: SiteFactQuestionCategory[]; raw?: DecideResult }> {
  const truncated = text.length > 12_000 ? `${text.slice(0, 12_000)}\n…` : text;
  const questions = Object.fromEntries(
    SITE_FACT_QUESTION_CATEGORIES.map((c) => [c, { type: "noul" as const, ...SITE_FACT_QUESTIONS[c] }]),
  );
  const raw = await client.decide({
    timeoutMs: 2000,
    state: {
      decision_id: DECISION_ID_TOUCHES_SITE_FACTS,
      proposed_text: truncated,
    },
    questions,
  });

  if (raw.status === "unavailable") {
    return { outcome: "unavailable", categories: [], raw };
  }

  const categories = SITE_FACT_QUESTION_CATEGORIES.filter((c) => {
    const ans = raw.answers[c] as { noul?: number } | undefined;
    return typeof ans?.noul === "number" && ans.noul >= TOUCHES_SITE_FACTS_NOUL_THRESHOLD;
  });
  return { outcome: "ok", categories, raw };
}

export const DECISION_ID_HARDCODED_SITE_FACT_LITERAL = "content.hardcoded_site_fact_literal";

/** Noul above this → text states a site fact as a literal rather than a variable token. */
export const HARDCODED_SITE_FACT_LITERAL_NOUL_THRESHOLD = 0.55;

/** Cap changed-field text sent to Jev for the fact-literals layer-2 check. */
export const HARDCODED_SITE_FACT_LITERAL_MAX_CHARS = 1_500;

export type HardcodedSiteFactLiteralOutcome = "yes" | "no" | "unavailable";

/**
 * Tiny one-noul: does this changed copy state a site fact (price, hire rate, salary,
 * rating count, campuses, etc.) as a typed number instead of a {{ global.* }} token?
 * Fail-open when the decision model is down.
 */
export async function askHardcodedSiteFactLiteral(
  client: DecisionClient,
  text: string,
): Promise<{ outcome: HardcodedSiteFactLiteralOutcome; raw?: DecideResult }> {
  const trimmed = text.trim();
  if (!trimmed) return { outcome: "no" };
  const truncated =
    trimmed.length > HARDCODED_SITE_FACT_LITERAL_MAX_CHARS
      ? `${trimmed.slice(0, HARDCODED_SITE_FACT_LITERAL_MAX_CHARS)}\n…`
      : trimmed;
  const raw = await client.decide({
    timeoutMs: 2000,
    state: {
      decision_id: DECISION_ID_HARDCODED_SITE_FACT_LITERAL,
      proposed_text: truncated,
    },
    questions: {
      hardcoded_site_fact: {
        type: "noul",
        instructions:
          "Does this text state a company or product fact as a hardcoded number or money amount " +
          "(tuition, monthly price, hire rate, salary, review count, rating, campuses, hiring partners) " +
          "that should normally come from a site variable token, rather than only educational examples or one-off cohort chart figures?",
        true: "States a reusable site fact as a literal number or price.",
        false:
          "No reusable site fact — ordinary copy, a one-off cohort/chart figure, or only variable tokens.",
      },
    },
  });

  if (raw.status === "unavailable") {
    return { outcome: "unavailable", raw };
  }

  const ans = raw.answers.hardcoded_site_fact as { noul?: number } | undefined;
  const noul = typeof ans?.noul === "number" ? ans.noul : 0;
  return {
    outcome: noul >= HARDCODED_SITE_FACT_LITERAL_NOUL_THRESHOLD ? "yes" : "no",
    raw,
  };
}

export const DECISION_ID_FUNNEL_CLASSIFICATION = "funnel.classify";

/** Noul above this → persona/product/`all` fits the page. */
export const FUNNEL_CLASSIFY_NOUL_THRESHOLD = 0.55;

/** Max persona noul questions per call (plus product-only + products_all + stage). */
export const FUNNEL_CLASSIFY_MAX_PERSONAS = 24;

export type FunnelClassifyPersona = {
  id: string;
  label: string;
  role: string;
  industry_or_context?: string;
};

export type FunnelClassifyProduct = {
  slug: string;
  name?: string;
  personas: FunnelClassifyPersona[];
};

export type FunnelClassifyConfidence = {
  stage: number;
  bindings: Array<{ product: string; persona?: string; score: number }>;
  products_all?: number;
};

export type FunnelClassifyOk = {
  outcome: "ok";
  stage: FunnelStage;
  products: FunnelProductBinding[] | "all";
  confidence: FunnelClassifyConfidence;
  model: string;
  prompt_snapshot: { state: Record<string, unknown>; questions: Record<string, DecisionQuestion> };
  raw?: DecideResult;
};

export type FunnelClassifyUnavailable = {
  outcome: "unavailable";
  raw?: DecideResult;
};

export type FunnelClassifyUnclear = {
  outcome: "unclear";
  message: string;
  raw?: DecideResult;
};

export type FunnelClassifyResult = FunnelClassifyOk | FunnelClassifyUnavailable | FunnelClassifyUnclear;

function noulOf(answers: Record<string, unknown>, key: string): number {
  const ans = answers[key] as { noul?: number } | undefined;
  return typeof ans?.noul === "number" ? ans.noul : 0;
}

/**
 * Score page buyer fit: stage choice + noul per persona / product-only / products:all.
 * Caller must gate thin snippets before calling.
 */
export async function askFunnelClassification(
  client: DecisionClient,
  opts: {
    page_snippet: string;
    products: FunnelClassifyProduct[];
  },
): Promise<FunnelClassifyResult> {
  const snippet = opts.page_snippet.trim();
  const catalog = opts.products
    .map((p) => ({
      slug: p.slug.trim(),
      name: p.name?.trim() || p.slug.trim(),
      personas: (p.personas ?? [])
        .map((pe) => ({
          id: pe.id.trim(),
          label: pe.label.trim() || pe.role.trim() || pe.id.trim(),
          role: pe.role.trim() || pe.label.trim() || pe.id.trim(),
          ...(pe.industry_or_context?.trim()
            ? { industry_or_context: pe.industry_or_context.trim() }
            : {}),
        }))
        .filter((pe) => pe.id),
    }))
    .filter((p) => p.slug);

  const personaKeys: Array<{ key: string; product: string; persona: string }> = [];
  const productOnlyKeys: Array<{ key: string; product: string }> = [];
  for (const p of catalog) {
    if (p.personas.length === 0) {
      productOnlyKeys.push({ key: `product_${p.slug}`, product: p.slug });
    } else {
      for (const pe of p.personas) {
        if (personaKeys.length >= FUNNEL_CLASSIFY_MAX_PERSONAS) break;
        personaKeys.push({
          key: `persona_${p.slug}__${pe.id}`,
          product: p.slug,
          persona: pe.id,
        });
      }
    }
  }

  const questions: Record<string, DecisionQuestion> = {
    stage: {
      type: "choice",
      instructions:
        "Which funnel stage matches how ready the reader is, based only on this page's title, hero, and CTAs — not how broad the topic feels?",
      awareness: "Top of funnel — widest / most general; not ready to buy.",
      consideration: "Middle of funnel — evaluating a target buyer persona / offer.",
      decision: "Bottom of funnel — ready to buy (money page).",
      "post-enrollment": "After purchase — onboarding or upsell for enrolled students.",
    },
    products_all: {
      type: "noul",
      instructions:
        "Is this page a true site/brand story that fits no single product's buyers better — so products should be \"all\"? Do not say yes only because the topic feels company-wide or educational.",
      true: "No single product's personas are a better fit; true site-wide / brand story.",
      false: "At least one product's buyers match this page better than site-wide \"all\".",
    },
  };

  for (const { key, product } of productOnlyKeys) {
    const row = catalog.find((p) => p.slug === product);
    questions[key] = {
      type: "noul",
      instructions: `Does this page speak to buyers of the product "${row?.name ?? product}" (slug ${product})? The product has no personas yet — judge product fit only.`,
      true: `Page intent matches product ${product}.`,
      false: `Page intent does not match product ${product}.`,
    };
  }

  for (const { key, product, persona } of personaKeys) {
    const row = catalog.find((p) => p.slug === product);
    const pe = row?.personas.find((x) => x.id === persona);
    const who = pe
      ? `${pe.label} (${pe.role}${pe.industry_or_context ? `; ${pe.industry_or_context}` : ""})`
      : persona;
    questions[key] = {
      type: "noul",
      instructions: `Does this page talk to the persona "${who}" on product "${row?.name ?? product}"? Judge from title, hero, and CTAs — sibling page usage is not evidence.`,
      true: `Page speaks to persona ${persona} on ${product}.`,
      false: `Page does not speak to persona ${persona} on ${product}.`,
    };
  }

  const state = {
    decision_id: DECISION_ID_FUNNEL_CLASSIFICATION,
    page_snippet: snippet.length > 12_000 ? `${snippet.slice(0, 12_000)}\n…` : snippet,
    products: catalog,
  };

  const raw = await client.decide({
    timeoutMs: 3500,
    state,
    questions,
  });

  if (raw.status === "unavailable") {
    return { outcome: "unavailable", raw };
  }

  const answers = raw.answers as Record<string, unknown>;
  const stageAns = answers.stage as { choice?: string; confidence?: number } | undefined;
  const stageChoice = typeof stageAns?.choice === "string" ? stageAns.choice.trim() : "";
  if (!isFunnelStage(stageChoice)) {
    return {
      outcome: "unclear",
      message: "Decision model did not return a valid funnel stage.",
      raw,
    };
  }
  const stageConfidence =
    typeof stageAns?.confidence === "number" ? stageAns.confidence : FUNNEL_CLASSIFY_NOUL_THRESHOLD;

  const allScore = noulOf(answers, "products_all");
  const bindingScores: FunnelClassifyConfidence["bindings"] = [];

  for (const { key, product, persona } of personaKeys) {
    const score = noulOf(answers, key);
    if (score >= FUNNEL_CLASSIFY_NOUL_THRESHOLD) {
      bindingScores.push({ product, persona, score });
    }
  }
  for (const { key, product } of productOnlyKeys) {
    const score = noulOf(answers, key);
    if (score >= FUNNEL_CLASSIFY_NOUL_THRESHOLD) {
      bindingScores.push({ product, score });
    }
  }

  bindingScores.sort((a, b) => b.score - a.score);

  let products: FunnelProductBinding[] | "all";
  if (bindingScores.length > 0) {
    products = bindingScores.map((b) =>
      b.persona ? { product: b.product, persona: b.persona } : { product: b.product },
    );
  } else if (allScore >= FUNNEL_CLASSIFY_NOUL_THRESHOLD) {
    products = "all";
  } else {
    return {
      outcome: "unclear",
      message: "No product or persona scored high enough for this page.",
      raw,
    };
  }

  return {
    outcome: "ok",
    stage: stageChoice,
    products,
    confidence: {
      stage: stageConfidence,
      bindings: bindingScores,
      ...(products === "all" ? { products_all: allScore } : {}),
    },
    model: raw.model,
    prompt_snapshot: { state, questions },
    raw,
  };
}

/** Normalize funnel blocks for equality / stale checks (order-insensitive bindings). */
export function funnelBlocksEqual(a: FunnelBlock, b: FunnelBlock): boolean {
  const stageA = typeof a.stage === "string" ? a.stage.trim() : "";
  const stageB = typeof b.stage === "string" ? b.stage.trim() : "";
  if (stageA !== stageB) return false;
  const pa = a.products;
  const pb = b.products;
  if (pa === "all" && pb === "all") return true;
  if (pa === "all" || pb === "all") return false;
  const la = Array.isArray(pa) ? pa : [];
  const lb = Array.isArray(pb) ? pb : [];
  if (la.length !== lb.length) return false;
  const key = (x: FunnelProductBinding) => `${x.product}\0${x.persona ?? ""}`;
  const sa = [...la.map(key)].sort();
  const sb = [...lb.map(key)].sort();
  return sa.every((k, i) => k === sb[i]);
}

/** Compact snapshot stored as based_on_funnel / suggested cascade. */
export function funnelBlockSnapshot(block: FunnelBlock): FunnelBlock {
  const out: FunnelBlock = {};
  if (typeof block.stage === "string" && block.stage.trim()) {
    out.stage = block.stage.trim();
  }
  if (block.products === "all") {
    out.products = "all";
  } else if (Array.isArray(block.products) && block.products.length > 0) {
    out.products = block.products.map((b) =>
      b.persona ? { product: b.product, persona: b.persona } : { product: b.product },
    );
  }
  return out;
}

/** @internal stages list for tests */
export const FUNNEL_CLASSIFY_STAGES = FUNNEL_STAGES;
