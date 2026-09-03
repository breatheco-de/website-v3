/** Frontmatter on Ask Agent markdown templates (not pasted into the clipboard prompt). */
export type AskAgentPromptFrontmatter = {
  id: string;
  version: number;
  title: string;
  /** When staff triggers this prompt (UI surface). */
  used_when: string;
  /** Desired agent outcome. */
  intention: string;
  /** What a good run looks like. */
  success_looks_like: string;
  /** Anti-goals the body should block. */
  failure_modes: string[];
  /** Placeholder names required in the body (`{{name}}`). */
  required: string[];
  /** Soft length budget enforced in vitest. */
  max_chars: number;
  /** Section headers that must appear in the body (e.g. Goal, Target). */
  sections: string[];
};

export type AskAgentPromptTemplate = {
  frontmatter: AskAgentPromptFrontmatter;
  body: string;
};

export type AskAgentPromptId =
  | "organic-page2"
  | "organic-low-ctr"
  | "organic-missing-serp"
  | "organic-link-gaps"
  | "page-diagnostics"
  | "draft-feedback";

export const ASK_AGENT_PROMPT_IDS: AskAgentPromptId[] = [
  "organic-page2",
  "organic-low-ctr",
  "organic-missing-serp",
  "organic-link-gaps",
  "page-diagnostics",
  "draft-feedback",
];
