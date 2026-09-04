import {
  AGENT_FILTER_OTHER,
  AGENT_IDS,
  formatAgentLabel,
  resolveAgentId,
  type AgentId,
} from "@shared/event-log-filters";

import darkAntigravity from "@/assets/agents/dark-antigravity.png";
import darkAppleIntelligent from "@/assets/agents/dark-apple-intelligent.png";
import darkChatGpt from "@/assets/agents/dark-chatGPT.png";
import darkClaude from "@/assets/agents/dark-claude.png";
import darkCodex from "@/assets/agents/dark-codex.png";
import darkCohere from "@/assets/agents/dark-cohere.png";
import darkCopilot from "@/assets/agents/dark-copilot.png";
import darkDeepSeek from "@/assets/agents/dark-deepSeek.png";
import darkFireworksAi from "@/assets/agents/dark-fireworks-ai.png";
import darkGemini from "@/assets/agents/dark-gemini.png";
import darkGrok from "@/assets/agents/dark-grok.png";
import darkHuggingFace from "@/assets/agents/dark-hugging-face.png";
import darkKimi from "@/assets/agents/dark-kimi.png";
import darkManus from "@/assets/agents/dark-manus.png";
import darkMinimax from "@/assets/agents/dark-minimax.png";
import darkMistral from "@/assets/agents/dark-Mistral.png";
import darkNotion from "@/assets/agents/dark-notion.png";
import darkPerplexity from "@/assets/agents/dark-perplexity.png";
import darkPoe from "@/assets/agents/dark-poe.png";
import darkQwen from "@/assets/agents/dark-qwen.png";
import darkStabilityAi from "@/assets/agents/dark-stability-ai.png";
import darkZGlm from "@/assets/agents/dark-z-glm.png";

import lightAntigravity from "@/assets/agents/light-antigravity.png";
import lightAppleIntelligent from "@/assets/agents/light-apple-intelligent.png";
import lightChatGpt from "@/assets/agents/light-chatgpt.png";
import lightClaude from "@/assets/agents/light-claude.png";
import lightCodex from "@/assets/agents/light-codex.png";
import lightCohere from "@/assets/agents/light-cohere.png";
import lightCopilot from "@/assets/agents/light-copilot.png";
import lightDeepSeek from "@/assets/agents/light-deepseek.png";
import lightFireworksAi from "@/assets/agents/light-fireworks-ai.png";
import lightGemini from "@/assets/agents/light-gemini.png";
import lightGrok from "@/assets/agents/light-grok.png";
import lightHuggingFace from "@/assets/agents/light-hugging-face.png";
import lightKimi from "@/assets/agents/light-kimi.png";
import lightManus from "@/assets/agents/light-manus.png";
import lightMinimax from "@/assets/agents/light-minimax.png";
import lightMistral from "@/assets/agents/light-mistral.png";
import lightNotion from "@/assets/agents/light-notion.png";
import lightPerplexity from "@/assets/agents/light-perplexity.png";
import lightPoe from "@/assets/agents/light-poe.png";
import lightQwen from "@/assets/agents/light-qwen.png";
import lightStabilityAi from "@/assets/agents/light-stability-ai.png";
import lightZGlm from "@/assets/agents/light-z-glm.png";

export type AgentTheme = "dark" | "light";

export {
  AGENT_FILTER_OTHER,
  AGENT_IDS,
  formatAgentLabel,
  resolveAgentId,
  type AgentId,
};

const DARK_ICONS: Record<AgentId, string> = {
  antigravity: darkAntigravity,
  "apple-intelligent": darkAppleIntelligent,
  chatgpt: darkChatGpt,
  claude: darkClaude,
  codex: darkCodex,
  cohere: darkCohere,
  copilot: darkCopilot,
  deepseek: darkDeepSeek,
  "fireworks-ai": darkFireworksAi,
  gemini: darkGemini,
  grok: darkGrok,
  "hugging-face": darkHuggingFace,
  kimi: darkKimi,
  manus: darkManus,
  minimax: darkMinimax,
  mistral: darkMistral,
  notion: darkNotion,
  perplexity: darkPerplexity,
  poe: darkPoe,
  qwen: darkQwen,
  "stability-ai": darkStabilityAi,
  "z-glm": darkZGlm,
};

const LIGHT_ICONS: Record<AgentId, string> = {
  antigravity: lightAntigravity,
  "apple-intelligent": lightAppleIntelligent,
  chatgpt: lightChatGpt,
  claude: lightClaude,
  codex: lightCodex,
  cohere: lightCohere,
  copilot: lightCopilot,
  deepseek: lightDeepSeek,
  "fireworks-ai": lightFireworksAi,
  gemini: lightGemini,
  grok: lightGrok,
  "hugging-face": lightHuggingFace,
  kimi: lightKimi,
  manus: lightManus,
  minimax: lightMinimax,
  mistral: lightMistral,
  notion: lightNotion,
  perplexity: lightPerplexity,
  poe: lightPoe,
  qwen: lightQwen,
  "stability-ai": lightStabilityAi,
  "z-glm": lightZGlm,
};

export function getAgentIconUrl(
  agentId: AgentId | null | undefined,
  theme: AgentTheme,
): string | null {
  if (!agentId) return null;
  const map = theme === "dark" ? DARK_ICONS : LIGHT_ICONS;
  return map[agentId] ?? null;
}

export function getDocumentTheme(): AgentTheme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}
