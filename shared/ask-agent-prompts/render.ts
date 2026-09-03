import { interpolateAskAgentBody, parseAskAgentPromptMarkdown } from "./parse";
import type { AskAgentPromptId, AskAgentPromptTemplate } from "./types";

type TemplateSource = Map<AskAgentPromptId, AskAgentPromptTemplate> | ((id: AskAgentPromptId) => AskAgentPromptTemplate);

let source: TemplateSource | null = null;

/** Register templates (Vite ?raw map or disk-loaded map). Call once at app/test bootstrap. */
export function setAskAgentPromptSource(next: TemplateSource): void {
  source = next;
}

export function getAskAgentTemplate(id: AskAgentPromptId): AskAgentPromptTemplate {
  if (!source) {
    throw new Error("Ask Agent prompt source not registered. Call setAskAgentPromptSource first.");
  }
  if (typeof source === "function") {
    return source(id);
  }
  const tpl = source.get(id);
  if (!tpl) {
    throw new Error(`Unknown Ask Agent prompt id: ${id}`);
  }
  return tpl;
}

/** Parse raw markdown and register under its frontmatter id (used by Vite client bootstrap). */
export function registerAskAgentPromptRaw(id: AskAgentPromptId, raw: string): AskAgentPromptTemplate {
  const tpl = parseAskAgentPromptMarkdown(raw);
  if (tpl.frontmatter.id !== id) {
    throw new Error(`Ask Agent template id mismatch: expected ${id}, got ${tpl.frontmatter.id}`);
  }
  if (!source || typeof source === "function") {
    source = new Map();
  }
  source.set(id, tpl);
  return tpl;
}

export function renderAskAgentPrompt(id: AskAgentPromptId, vars: Record<string, string>): string {
  const tpl = getAskAgentTemplate(id);
  return interpolateAskAgentBody(tpl.body, vars, tpl.frontmatter.required);
}
