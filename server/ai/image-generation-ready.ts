/**
 * Probe whether OpenRouter image generation is configured for a content root.
 */
import {
  resolveImageModel,
  resolveLLMApiKey,
  resolveLLMBaseURL,
  OPENROUTER_DEFAULT_BASE_URL,
} from "./LLMService";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import { getDefaultContentRoot } from "../site-config";

type LlmProvider = {
  api_key_env?: string;
  base_url_env?: string;
};

function readProvider(contentRoot?: string): LlmProvider {
  try {
    const root = contentRoot || getDefaultContentRoot();
    const llmPath = path.join(root, "llm.yml");
    if (!fs.existsSync(llmPath)) return {};
    const raw = yaml.load(fs.readFileSync(llmPath, "utf-8")) as {
      provider?: LlmProvider;
    } | null;
    return raw?.provider || {};
  } catch {
    return {};
  }
}

export function resolveImageGenerationReady(contentRoot?: string):
  | { ok: true; model: string }
  | { ok: false; error: string; hint: string; model: string } {
  const provider = readProvider(contentRoot);
  const apiKeyEnv = provider.api_key_env || "OPENROUTER_API_KEY";
  const baseUrlEnv = provider.base_url_env || "OPENROUTER_BASE_URL";
  const apiKey = resolveLLMApiKey(apiKeyEnv);
  const baseURL = resolveLLMBaseURL(baseUrlEnv) || OPENROUTER_DEFAULT_BASE_URL;
  const model = resolveImageModel(contentRoot);

  if (!apiKey) {
    return {
      ok: false,
      model,
      error: `API key not configured. Set ${apiKeyEnv} in environment.`,
      hint: `Add model.image in llm.yml and set ${apiKeyEnv}. Image generation uses OpenRouter POST /images.`,
    };
  }
  if (!baseURL) {
    return {
      ok: false,
      model,
      error: `Base URL not configured for ${baseUrlEnv}.`,
      hint: `Set ${baseUrlEnv} or rely on the OpenRouter default.`,
    };
  }
  return { ok: true, model };
}
