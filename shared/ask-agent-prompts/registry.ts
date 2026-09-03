import type { AskAgentPromptId } from "./types";
import { ASK_AGENT_PROMPT_IDS } from "./types";

/** Filename stem matches prompt id. */
export function askAgentPromptFilename(id: AskAgentPromptId): string {
  return `${id}.md`;
}

export function isAskAgentPromptId(id: string): id is AskAgentPromptId {
  return (ASK_AGENT_PROMPT_IDS as string[]).includes(id);
}

export { ASK_AGENT_PROMPT_IDS };
