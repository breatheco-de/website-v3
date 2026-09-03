/**
 * AI helpers used across chat, tables, schema generation, and related features.
 * Entry-level content adaptation (adapt-with-AI) was removed.
 */

export { getLLMService, LLMService } from "./LLMService";
export { generateJsonSchema } from "./generateJsonSchema";

export type {
  BrandContext,
  ComponentContext,
  ILLMClient,
  LLMOptions,
  ICache,
} from "./types";

export type {
  GenerateJsonSchemaInput,
  GenerateJsonSchemaResult,
} from "./generateJsonSchema";
