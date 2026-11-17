import { createContext, useContext } from "react";

/**
 * True while rendering the AI-crawler HTML copy (SSR audience-llm) or staff
 * LLM crawler preview on /private/preview (`preview_mode=llm`).
 */
export const LlmAudienceContext = createContext(false);

export function useLlmAudience(): boolean {
  return useContext(LlmAudienceContext);
}
