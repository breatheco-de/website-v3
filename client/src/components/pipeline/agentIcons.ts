import type { EventAttributionEntry } from "@/lib/formatIssueActor";

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

/** Known LLM / product agent slugs matching assets under client/src/assets/agents/. */
export const AGENT_IDS = [
  "antigravity",
  "apple-intelligent",
  "chatgpt",
  "claude",
  "codex",
  "cohere",
  "copilot",
  "deepseek",
  "fireworks-ai",
  "gemini",
  "grok",
  "hugging-face",
  "kimi",
  "manus",
  "minimax",
  "mistral",
  "notion",
  "perplexity",
  "poe",
  "qwen",
  "stability-ai",
  "z-glm",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

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

/** Longer / more specific aliases first so e.g. apple-intelligent beats apple. */
const ALIAS_TO_ID: Array<{ pattern: RegExp; id: AgentId }> = [
  { pattern: /apple[\s_-]?intelligent|apple\s*intelligence/i, id: "apple-intelligent" },
  { pattern: /hugging[\s_-]?face|huggingface|hf\b/i, id: "hugging-face" },
  { pattern: /fireworks/i, id: "fireworks-ai" },
  { pattern: /stability/i, id: "stability-ai" },
  { pattern: /antigravity/i, id: "antigravity" },
  { pattern: /chatgpt|chat[\s_-]?gpt|\bgpt[\s_-]?\d|o[1-4]\b|openai/i, id: "chatgpt" },
  { pattern: /claude|anthropic|sonnet|opus|haiku/i, id: "claude" },
  { pattern: /codex/i, id: "codex" },
  { pattern: /cohere|command[\s_-]?r/i, id: "cohere" },
  { pattern: /copilot|github[\s_-]?copilot/i, id: "copilot" },
  { pattern: /deepseek/i, id: "deepseek" },
  { pattern: /gemini|gemma/i, id: "gemini" },
  { pattern: /grok/i, id: "grok" },
  { pattern: /\bkimi\b|moonshot/i, id: "kimi" },
  { pattern: /manus/i, id: "manus" },
  { pattern: /minimax/i, id: "minimax" },
  { pattern: /mistral|mixtral/i, id: "mistral" },
  { pattern: /notion/i, id: "notion" },
  { pattern: /perplexity|sonar/i, id: "perplexity" },
  { pattern: /\bpoe\b/i, id: "poe" },
  { pattern: /qwen|qwq/i, id: "qwen" },
  { pattern: /\bglm\b|z[\s_-]?glm|zhipu/i, id: "z-glm" },
];

function matchAgentId(raw: string | undefined | null): AgentId | null {
  if (!raw?.trim()) return null;
  const text = raw.trim();
  const normalized = text.toLowerCase().replace(/[_\s]+/g, "-");
  for (const id of AGENT_IDS) {
    if (normalized === id || normalized.includes(id)) return id;
  }
  for (const { pattern, id } of ALIAS_TO_ID) {
    if (pattern.test(text)) return id;
  }
  return null;
}

/**
 * Resolve primary attribution to an agent icon id.
 * MCP: prefer model, then client. Non-MCP / unmatched → null (generic Bot fallback).
 */
export function resolveAgentId(
  attribution: EventAttributionEntry[] | undefined | null,
): AgentId | null {
  const primary = attribution?.[0];
  if (!primary?.actor || primary.actor.type !== "mcp") return null;
  return matchAgentId(primary.actor.model) ?? matchAgentId(primary.actor.client);
}

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

/** Sentinel for staff / system / unmatched agents in filters. */
export const AGENT_FILTER_OTHER = "__other__";

/** Human label for agent filter dropdowns. */
export function formatAgentLabel(agentId: AgentId | typeof AGENT_FILTER_OTHER): string {
  if (agentId === AGENT_FILTER_OTHER) return "Staff & system";
  return agentId
    .split("-")
    .map((part) => {
      if (part === "ai") return "AI";
      if (part === "chatgpt") return "ChatGPT";
      if (part === "glm") return "GLM";
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}
