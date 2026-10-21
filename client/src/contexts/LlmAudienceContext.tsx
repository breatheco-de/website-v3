import { createContext, useContext } from "react";

/** True only while the server renders the AI-crawler HTML copy. The browser stays false. */
export const LlmAudienceContext = createContext(false);

export function useLlmAudience(): boolean {
  return useContext(LlmAudienceContext);
}
