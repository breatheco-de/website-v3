/**
 * Product decision ids + thresholds. Policy lives here; HTTP client stays dumb.
 */

import type { DecisionClient, DecideResult } from "./types";

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
