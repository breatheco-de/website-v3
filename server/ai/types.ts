/**
 * Shared AI type definitions.
 */

/** Brand context from site brand-context.yml (SEO/GEO and other brand readers). */
export interface BrandContext {
  brand: {
    name: string;
    tagline: string;
    mission: string;
  };
  voice: {
    tone: string;
    style: string;
    personality: string;
  };
  guidelines: string[];
  key_differentiators: string[];
  target_audience: {
    primary: {
      description: string;
      age_range: string;
      motivations: string[];
      concerns: string[];
    };
    secondary: {
      description: string;
      age_range: string;
      motivations: string[];
    };
  };
  messaging_priorities: Array<{
    name: string;
    weight: number;
    examples: string[];
  }>;
  forbidden_phrases: string[];
  required_disclaimers: Record<string, string>;
  content_patterns: Record<string, {
    max_length?: number;
    structure?: string;
    examples?: string[];
  }>;
}

export interface PropDefinition {
  type: string;
  required?: boolean;
  description?: string;
  default?: unknown;
  properties?: Record<string, PropDefinition>;
  items?: Record<string, PropDefinition>;
}

/** Component-level context from component registry schema.yml */
export interface ComponentContext {
  name: string;
  version: string;
  description?: string;
  when_to_use?: string;
  variants?: Record<string, {
    description?: string;
    when_to_use?: string;
    best_for?: string;
  }>;
  props: Record<string, PropDefinition>;
  variant_props?: Record<string, Record<string, PropDefinition>>;
}

export interface ILLMClient {
  complete(prompt: string, options?: LLMOptions): Promise<string>;
}

export interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface StructuredOutputOptions extends Omit<LLMOptions, "systemPrompt"> {
  jsonSchema: Record<string, unknown>;
  schemaName?: string;
}

export interface ICache<T> {
  get(key: string): { value: T; mtime: number } | null;
  set(key: string, value: T, mtime: number): void;
  invalidate(key: string): void;
  invalidateAll(): void;
}
