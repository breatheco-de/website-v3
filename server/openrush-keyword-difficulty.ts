/**
 * Keyword difficulty from an OpenRush inspect_keyword payload, with where the number came from.
 * `reported`: OpenRush sent a difficulty field. `derived_from_competition`: we mapped its
 * competition score/label (ad competition, not ranking difficulty) onto 0–100.
 */

export type KeywordDifficultySource = "reported" | "derived_from_competition";

export type KeywordDifficultyReading = {
  value: number | null;
  source: KeywordDifficultySource | null;
  competition_level: string | number | null;
};

const REPORTED_KEYS = ["difficulty", "keyword_difficulty", "kd"] as const;

const COMPETITION_LABEL_SCORES: Record<string, number> = {
  low: 20,
  medium: 50,
  moderate: 50,
  high: 80,
  very_high: 90,
  very_hard: 90,
};

function clampDifficulty(n: number): number {
  const scaled = n > 0 && n <= 1 ? n * 100 : n;
  return Math.round(Math.min(100, Math.max(0, scaled)));
}

function finiteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function readKeywordDifficulty(
  data: Record<string, unknown> | null | undefined,
): KeywordDifficultyReading {
  const rec = data ?? {};
  const compRaw = rec.competition_level ?? rec.competition;
  const competition_level =
    typeof compRaw === "string" || typeof compRaw === "number" ? compRaw : null;

  for (const key of REPORTED_KEYS) {
    const v = rec[key];
    if (finiteNumber(v)) {
      return { value: clampDifficulty(v), source: "reported", competition_level };
    }
  }

  if (finiteNumber(rec.competition_score)) {
    return {
      value: clampDifficulty(rec.competition_score),
      source: "derived_from_competition",
      competition_level,
    };
  }
  if (finiteNumber(compRaw)) {
    return { value: clampDifficulty(compRaw), source: "derived_from_competition", competition_level };
  }
  if (typeof compRaw === "string" && compRaw.trim()) {
    const label = compRaw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const mapped = COMPETITION_LABEL_SCORES[label];
    if (mapped != null) {
      return { value: mapped, source: "derived_from_competition", competition_level };
    }
  }
  return { value: null, source: null, competition_level };
}
