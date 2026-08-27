/**
 * LLM Service - Factory pattern with retry/backoff for OpenAI-compatible API calls
 * (OpenRouter by default). Reads provider/model config from the site content root llm.yml.
 */

import OpenAI from "openai";
import { getDefaultContentRoot } from "../site-config";
import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import type { ILLMClient, LLMOptions, StructuredOutputOptions } from "./types";
import { child } from "../logger";
const log = child({ module: "ai/LLMService" });



interface LLMYamlConfig {
  provider?: {
    api_key_env?: string;
    base_url_env?: string;
  };
  model?: string | { default: string; chat?: string; vision?: string; image?: string };
  temperature?: number;
  max_tokens?: number;
}

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
export const OPENROUTER_DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_COMPLETION_MODEL = "openai/gpt-4o-mini";
export const DEFAULT_VISION_MODEL = "openai/gpt-4o";
export const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";

/** Resolve API base URL from llm.yml env names, with OpenRouter soft-default. */
export function resolveLLMBaseURL(baseUrlEnv: string): string | undefined {
  const fromEnv = process.env[baseUrlEnv];
  if (fromEnv) return fromEnv;
  if (baseUrlEnv === "OPENROUTER_BASE_URL") return OPENROUTER_DEFAULT_BASE_URL;
  return undefined;
}

/** Resolve API key from the env var named in llm.yml (provider.api_key_env). */
export function resolveLLMApiKey(apiKeyEnv: string): string | undefined {
  return process.env[apiKeyEnv] || undefined;
}

let instance: LLMService | null = null;
let cachedConfigMtime: number | null = null;

function getDefaultLLMPath(): string {
  return path.join(getDefaultContentRoot(), "llm.yml");
}

function loadYamlConfig(contentRoot?: string): LLMYamlConfig | null {
  try {
    const configPath = contentRoot ? path.join(contentRoot, "llm.yml") : getDefaultLLMPath();
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf-8");
      return yaml.load(raw) as LLMYamlConfig;
    }
  } catch (err) {
    log.warn("Failed to load llm.yml config, using env var fallback:", err);
  }
  return null;
}

function getConfigMtime(contentRoot?: string): number | null {
  try {
    const configPath = contentRoot ? path.join(contentRoot, "llm.yml") : getDefaultLLMPath();
    if (fs.existsSync(configPath)) {
      return fs.statSync(configPath).mtimeMs;
    }
  } catch {
    /* ignore */
  }
  return null;
}

function resolveModel(cfg: LLMYamlConfig | null): string {
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  if (cfg?.model && typeof cfg.model === "object") {
    return cfg.model.default || DEFAULT_COMPLETION_MODEL;
  }
  return (cfg?.model as string | undefined) || DEFAULT_COMPLETION_MODEL;
}

/** Vision model from llm.yml (model.vision), falling back to model.default. */
export function resolveVisionModel(contentRoot?: string): string {
  const cfg = loadYamlConfig(contentRoot);
  if (cfg?.model && typeof cfg.model === "object" && cfg.model.vision) {
    return cfg.model.vision;
  }
  return resolveModel(cfg) || DEFAULT_VISION_MODEL;
}

/** Image generation model from llm.yml (model.image). */
export function resolveImageModel(contentRoot?: string): string {
  if (process.env.LLM_IMAGE_MODEL) return process.env.LLM_IMAGE_MODEL;
  const cfg = loadYamlConfig(contentRoot);
  if (cfg?.model && typeof cfg.model === "object" && cfg.model.image) {
    return cfg.model.image;
  }
  return DEFAULT_IMAGE_MODEL;
}

export type GenerateImagesResult = {
  model: string;
  candidates: Array<{ b64: string; mediaType: string }>;
};

export type GenerateImageCandidate = {
  index: number;
  b64: string;
  mediaType: string;
  model: string;
};

type OpenRouterImageError = Error & { status?: number; body?: string };

/** Provider rejected n > 1 (e.g. Gemini: "n: must be exactly 1"). */
export function isNMustBeOneRejection(body: string): boolean {
  return /n\s*>\s*1|single.?image|only support|must be exactly\s*1|n:\s*must|n must be/i.test(
    body,
  );
}

/** Provider rejected aspect_ratio (mentioned in 400 body). */
export function isUnsupportedAspectRatioRejection(body: string): boolean {
  return /aspect_ratio/i.test(body);
}

function openRouterErrorBody(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return (err as OpenRouterImageError).body || msg;
}

export class GenerateImagesCancelledError extends Error {
  constructor() {
    super("Image generation cancelled");
    this.name = "GenerateImagesCancelledError";
  }
}

/**
 * OpenRouter Image API with progressive candidates.
 * - Never sends output_format.
 * - Multi-n success: invokes onCandidate for each image from that response.
 * - If n > 1 is rejected, runs sequential n=1 calls and emits after each.
 * - Partial success: stops after emitting at least one when a later call fails.
 * - aspect_ratio rejection: retries without it.
 */
export async function generateImagesStream(
  opts: {
    prompt: string;
    n?: number;
    aspect_ratio?: string;
    contentRoot?: string;
    isCancelled?: () => boolean;
  },
  onCandidate: (c: GenerateImageCandidate) => void | Promise<void>,
): Promise<GenerateImagesResult> {
  const cfg = loadYamlConfig(opts.contentRoot);
  const apiKeyEnv = cfg?.provider?.api_key_env || "OPENROUTER_API_KEY";
  const baseUrlEnv = cfg?.provider?.base_url_env || "OPENROUTER_BASE_URL";
  const apiKey = resolveLLMApiKey(apiKeyEnv);
  const baseURL = resolveLLMBaseURL(baseUrlEnv);

  if (!apiKey || !baseURL) {
    throw new Error(
      `Image generation not configured. Set ${apiKeyEnv} (and optionally ${baseUrlEnv}) in environment.`,
    );
  }

  const model = resolveImageModel(opts.contentRoot);
  const requestedN = Math.min(4, Math.max(1, opts.n ?? 4));
  const checkCancelled = () => {
    if (opts.isCancelled?.()) throw new GenerateImagesCancelledError();
  };

  const callOnce = async (
    n: number,
    omitAspect: boolean,
  ): Promise<GenerateImagesResult> => {
    checkCancelled();
    const body: Record<string, unknown> = {
      model,
      prompt: opts.prompt,
      n,
    };
    if (opts.aspect_ratio && !omitAspect) {
      body.aspect_ratio = opts.aspect_ratio;
    }

    const res = await fetch(`${baseURL.replace(/\/$/, "")}/images`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
    });

    checkCancelled();
    const rawText = await res.text();
    if (!res.ok) {
      const err = new Error(
        `OpenRouter image generation failed (${res.status}): ${rawText.slice(0, 400)}`,
      ) as OpenRouterImageError;
      err.status = res.status;
      err.body = rawText;
      throw err;
    }

    let payload: {
      data?: Array<{ b64_json?: string; media_type?: string }>;
    };
    try {
      payload = JSON.parse(rawText) as typeof payload;
    } catch {
      throw new Error("OpenRouter image generation returned invalid JSON");
    }

    const candidates = (payload.data ?? [])
      .filter((d) => typeof d.b64_json === "string" && d.b64_json.length > 0)
      .map((d) => ({
        b64: d.b64_json as string,
        mediaType: d.media_type || "image/webp",
      }));

    if (candidates.length === 0) {
      throw new Error("OpenRouter returned no image candidates");
    }

    return { model, candidates };
  };

  const emitAll = async (
    list: GenerateImagesResult["candidates"],
    startIndex: number,
  ): Promise<number> => {
    let index = startIndex;
    for (const c of list) {
      checkCancelled();
      await onCandidate({
        index,
        b64: c.b64,
        mediaType: c.mediaType,
        model,
      });
      index += 1;
    }
    return index;
  };

  const collect = async (omitAspect: boolean): Promise<GenerateImagesResult> => {
    try {
      const batch = await callOnce(requestedN, omitAspect);
      await emitAll(batch.candidates, 0);
      return batch;
    } catch (err) {
      if (err instanceof GenerateImagesCancelledError) throw err;
      const body = openRouterErrorBody(err);
      if (requestedN > 1 && isNMustBeOneRejection(body)) {
        const nextOmit =
          omitAspect ||
          Boolean(opts.aspect_ratio && isUnsupportedAspectRatioRejection(body));
        log.warn(
          { model, requestedN, omitAspect: nextOmit },
          "[generateImages] n>1 rejected; running sequential n=1 calls",
        );
        const candidates: GenerateImagesResult["candidates"] = [];
        for (let i = 0; i < requestedN; i++) {
          try {
            checkCancelled();
            const one = await callOnce(1, nextOmit);
            await emitAll(one.candidates, candidates.length);
            candidates.push(...one.candidates);
          } catch (inner) {
            if (inner instanceof GenerateImagesCancelledError) throw inner;
            if (candidates.length > 0) {
              log.warn(
                {
                  model,
                  got: candidates.length,
                  requestedN,
                  error: openRouterErrorBody(inner).slice(0, 200),
                },
                "[generateImages] sequential n=1 partial success; returning collected",
              );
              return { model, candidates };
            }
            throw inner;
          }
        }
        return { model, candidates };
      }
      throw err;
    }
  };

  try {
    return await collect(false);
  } catch (err) {
    if (err instanceof GenerateImagesCancelledError) throw err;
    const body = openRouterErrorBody(err);
    if (opts.aspect_ratio && isUnsupportedAspectRatioRejection(body)) {
      log.warn(
        { model },
        "[generateImages] aspect_ratio rejected; retrying without it",
      );
      return await collect(true);
    }
    throw err;
  }
}

/**
 * Collecting wrapper around generateImagesStream (tests / non-streaming callers).
 */
export async function generateImages(opts: {
  prompt: string;
  n?: number;
  aspect_ratio?: string;
  contentRoot?: string;
}): Promise<GenerateImagesResult> {
  return generateImagesStream(opts, () => {});
}

export function getLLMConfig(): LLMYamlConfig {
  const cfg = loadYamlConfig();
  return {
    provider: cfg?.provider || {},
    model: resolveModel(cfg),
    temperature: cfg?.temperature ?? 0.7,
    max_tokens: cfg?.max_tokens || 2000,
  };
}

export function reloadLLMConfig(): void {
  cachedConfigMtime = null;
  instance = null;
}

export class LLMService implements ILLMClient {
  private client: OpenAI;
  private defaultModel: string;
  private defaultTemperature: number;
  private defaultMaxTokens: number;

  private constructor() {
    const cfg = loadYamlConfig();

    const apiKeyEnv = cfg?.provider?.api_key_env || "OPENROUTER_API_KEY";
    const baseUrlEnv = cfg?.provider?.base_url_env || "OPENROUTER_BASE_URL";

    const apiKey = resolveLLMApiKey(apiKeyEnv);
    const baseURL = resolveLLMBaseURL(baseUrlEnv);

    if (!apiKey) {
      throw new Error(
        `LLM not configured. Please set ${apiKeyEnv} in environment.`,
      );
    }

    this.client = new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
    });

    this.defaultModel = resolveModel(cfg);
    this.defaultTemperature = cfg?.temperature ?? 0.7;
    this.defaultMaxTokens = cfg?.max_tokens || 2000;
  }

  static getInstance(): LLMService {
    const currentMtime = getConfigMtime();
    if (
      instance &&
      cachedConfigMtime !== null &&
      currentMtime !== cachedConfigMtime
    ) {
      log.info("[LLM] Config file changed, reinitializing...");
      instance = null;
    }
    if (!instance) {
      instance = new LLMService();
      cachedConfigMtime = currentMtime;
    }
    return instance;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async complete(prompt: string, options?: LLMOptions): Promise<string> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? this.defaultTemperature;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;

    let lastError: Error | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (options?.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }
        messages.push({ role: "user", content: prompt });

        const response = await this.client.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        return content.trim();
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || "";

        if (
          errorMessage.includes("rate_limit") ||
          errorMessage.includes("429") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("network") ||
          errorMessage.includes("ECONNRESET")
        ) {
          log.warn(
            `LLM error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
          );
          await this.sleep(backoffMs);
          backoffMs *= 2;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Failed after max retries");
  }

  async completeWithVision(
    textPrompt: string,
    imageUrls: string[],
    options?: LLMOptions,
  ): Promise<string> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? this.defaultTemperature;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;

    let lastError: Error | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

        if (options?.systemPrompt) {
          messages.push({ role: "system", content: options.systemPrompt });
        }

        const contentParts: OpenAI.Chat.ChatCompletionContentPart[] = [
          { type: "text", text: textPrompt },
        ];
        for (const url of imageUrls) {
          contentParts.push({
            type: "image_url",
            image_url: { url },
          });
        }
        messages.push({ role: "user", content: contentParts });

        const response = await this.client.chat.completions.create({
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        return content.trim();
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || "";

        if (
          errorMessage.includes("rate_limit") ||
          errorMessage.includes("429") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("network") ||
          errorMessage.includes("ECONNRESET")
        ) {
          log.warn(
            `LLM vision error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
          );
          await this.sleep(backoffMs);
          backoffMs *= 2;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Failed after max retries");
  }

  async adaptContent(
    systemPrompt: string,
    userPrompt: string,
    options?: Omit<LLMOptions, "systemPrompt">,
  ): Promise<{
    content: string;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? 0.5;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;

    let lastError: Error | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        return {
          content: content.trim(),
          usage: response.usage
            ? {
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || "";

        if (
          errorMessage.includes("rate_limit") ||
          errorMessage.includes("429") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("network")
        ) {
          log.warn(
            `LLM error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
          );
          await this.sleep(backoffMs);
          backoffMs *= 2;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Failed after max retries");
  }

  async adaptContentStructured(
    systemPrompt: string,
    userPrompt: string,
    options: StructuredOutputOptions,
  ): Promise<{
    content: Record<string, unknown>;
    usage?: {
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
    };
  }> {
    const model = options?.model || this.defaultModel;
    const temperature = options?.temperature ?? 0.5;
    const maxTokens = options?.maxTokens || this.defaultMaxTokens;

    let lastError: Error | null = null;
    let backoffMs = INITIAL_BACKOFF_MS;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          max_tokens: maxTokens,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: options.schemaName || "component_content",
              strict: true,
              schema: options.jsonSchema,
            },
          },
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error("Empty response from LLM");
        }

        const parsed = JSON.parse(content);

        return {
          content: parsed,
          usage: response.usage
            ? {
                prompt_tokens: response.usage.prompt_tokens,
                completion_tokens: response.usage.completion_tokens,
                total_tokens: response.usage.total_tokens,
              }
            : undefined,
        };
      } catch (error) {
        lastError = error as Error;
        const errorMessage = lastError.message || "";

        if (
          errorMessage.includes("rate_limit") ||
          errorMessage.includes("429") ||
          errorMessage.includes("timeout") ||
          errorMessage.includes("network")
        ) {
          log.warn(
            `LLM error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${backoffMs}ms...`,
          );
          await this.sleep(backoffMs);
          backoffMs *= 2;
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error("Failed after max retries");
  }
}

export function getLLMService(): LLMService {
  return LLMService.getInstance();
}
