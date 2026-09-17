/**
 * Proposals hub for explain_site: optional subtopic + aliases for legacy flat topics.
 */

export type ProposalsSubtopicId =
  | "overview"
  | "reading"
  | "situations"
  | "internal-links"
  | "serp-title-description"
  | "funnel-classification"
  | "idea-opportunity-harm"
  | "translations";

export type ProposalsSubtopicDef = {
  id: ProposalsSubtopicId;
  description: string;
  /** Basename under mcp-server/explain/ (no .md). */
  fileStem: string;
};

/** Advertised subtopics when topic=proposals and subtopic omitted. */
export const PROPOSALS_SUBTOPICS: readonly ProposalsSubtopicDef[] = [
  {
    id: "overview",
    description: "Tools, four-eyes, kinds (edits/notes/ideas), MCP write overlay",
    fileStem: "proposals",
  },
  {
    id: "reading",
    description: "review_context axes, checklists, dispositions, create refuses",
    fileStem: "reading-proposals",
  },
  {
    id: "situations",
    description: "Catalog of review_situations ids; declare vs infer",
    fileStem: "review-situations",
  },
  {
    id: "internal-links",
    description: "Hub/internal link author + reviewer playbook",
    fileStem: "internal-links-proposals",
  },
  {
    id: "serp-title-description",
    description: "SERP title/description author + reviewer playbook",
    fileStem: "serp-title-description-proposals",
  },
  {
    id: "funnel-classification",
    description: "Funnel stage/products playbook (persona → product → stage)",
    fileStem: "funnel-classification-proposals",
  },
  {
    id: "idea-opportunity-harm",
    description: "Idea brief opportunity vs site harm before accept",
    fileStem: "idea-opportunity-harm-proposals",
  },
  {
    id: "translations",
    description: "Locale translation draft→promote author + reviewer playbook",
    fileStem: "proposals-translations",
  },
] as const;

const SUBTOPIC_BY_ID = new Map(PROPOSALS_SUBTOPICS.map((s) => [s.id, s]));

/** Legacy flat topic ids → proposals + subtopic (still resolve; not advertised). */
export const EXPLAIN_TOPIC_ALIASES: Record<
  string,
  { topic: "proposals"; subtopic: ProposalsSubtopicId }
> = {
  "reading-proposals": { topic: "proposals", subtopic: "reading" },
  "review-situations": { topic: "proposals", subtopic: "situations" },
  "internal-links-proposals": { topic: "proposals", subtopic: "internal-links" },
  "serp-title-description-proposals": {
    topic: "proposals",
    subtopic: "serp-title-description",
  },
  "funnel-classification-proposals": {
    topic: "proposals",
    subtopic: "funnel-classification",
  },
  "idea-opportunity-harm-proposals": {
    topic: "proposals",
    subtopic: "idea-opportunity-harm",
  },
};

export const PROPOSALS_INDEX_HUB = [
  "# Content proposals (index)",
  "",
  "Four-eyes entry proposals and issue notes. Pick a **subtopic** for the playbook you need.",
  "",
  "Call again with `topic: \"proposals\"` and `subtopic` set to one of the ids below.",
  "",
  "Authors declare `review_situations` on edits when a pack applies; empty → infer from ops (and summary cues for some packs).",
].join("\n");

export function isProposalsSubtopicId(value: string): value is ProposalsSubtopicId {
  return SUBTOPIC_BY_ID.has(value as ProposalsSubtopicId);
}

export function getProposalsSubtopic(id: string): ProposalsSubtopicDef | null {
  return SUBTOPIC_BY_ID.get(id as ProposalsSubtopicId) ?? null;
}

export function listProposalsSubtopicsPublic(): Array<{ id: string; description: string }> {
  return PROPOSALS_SUBTOPICS.map((s) => ({ id: s.id, description: s.description }));
}

export function resolveExplainTopicAlias(
  topic: string,
): { topic: string; subtopic?: string; deprecated_from?: string } {
  const alias = EXPLAIN_TOPIC_ALIASES[topic];
  if (!alias) return { topic };
  return {
    topic: alias.topic,
    subtopic: alias.subtopic,
    deprecated_from: topic,
  };
}
