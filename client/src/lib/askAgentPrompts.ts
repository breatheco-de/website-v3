/**
 * Client bootstrap: register Ask Agent markdown templates via Vite ?raw imports.
 * Import this module once before calling renderAskAgentPrompt / buildSolveWithAiPrompt.
 */
import { registerAskAgentPromptRaw, type AskAgentPromptId } from "@shared/ask-agent-prompts";

import organicPage2 from "@shared/ask-agent-prompts/organic-page2.md?raw";
import organicLowCtr from "@shared/ask-agent-prompts/organic-low-ctr.md?raw";
import organicMissingSerp from "@shared/ask-agent-prompts/organic-missing-serp.md?raw";
import organicLinkGaps from "@shared/ask-agent-prompts/organic-link-gaps.md?raw";
import pageDiagnostics from "@shared/ask-agent-prompts/page-diagnostics.md?raw";
import draftFeedback from "@shared/ask-agent-prompts/draft-feedback.md?raw";
import polishAskAgentPrompt from "@shared/ask-agent-prompts/polish-ask-agent-prompt.md?raw";

const RAW: Record<AskAgentPromptId, string> = {
  "organic-page2": organicPage2,
  "organic-low-ctr": organicLowCtr,
  "organic-missing-serp": organicMissingSerp,
  "organic-link-gaps": organicLinkGaps,
  "page-diagnostics": pageDiagnostics,
  "draft-feedback": draftFeedback,
  "polish-ask-agent-prompt": polishAskAgentPrompt,
};

let registered = false;

export function ensureAskAgentPromptsRegistered(): void {
  if (registered) return;
  for (const id of Object.keys(RAW) as AskAgentPromptId[]) {
    registerAskAgentPromptRaw(id, RAW[id]);
  }
  registered = true;
}

ensureAskAgentPromptsRegistered();
