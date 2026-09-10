import { z } from "zod";
import { DEFAULT_COMPLETION_MODEL, getLLMService } from "./LLMService";

export type PersonaOfferInput = {
  one_liner: string;
  who_its_for: string;
  who_its_not_for?: string;
};

export type ExistingPersonaSummary = {
  id: string;
  label?: string;
  role: string;
  industry_or_context?: string;
  demographics?: string;
  buying_behavior?: string;
  avatar?: {
    fears?: string[];
    internal_dialogue?: string;
    objections?: string[];
    aspirational_identity?: string;
  };
};

export type GeneratePersonaInput = {
  slug?: string;
  offer: PersonaOfferInput;
  existingPersonas: ExistingPersonaSummary[];
};

const proposedPersonaSchema = z.object({
  id: z.string().min(1),
  label: z.string().optional(),
  role: z.string().min(1),
  industry_or_context: z.string().optional(),
  demographics: z.string().optional(),
  buying_behavior: z.string().optional(),
  avatar: z.object({
    fears: z.array(z.string()).min(1),
    internal_dialogue: z.string().min(1),
    objections: z.array(z.string()).min(1),
    aspirational_identity: z.string().optional(),
  }),
});

const generatePersonaResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("persona"),
    persona: proposedPersonaSchema,
  }),
  z.object({
    status: z.literal("none"),
    reason: z.string().optional(),
  }),
]);

export type GeneratePersonaResult = z.infer<typeof generatePersonaResultSchema>;
export type ProposedPersona = z.infer<typeof proposedPersonaSchema>;

const SYSTEM_PROMPT = `You propose buyer personas for a product audience brief used in marketing funnels.

Rules:
- Return ONLY a JSON object. No markdown, no code fences, no commentary.
- Either propose ONE new distinct persona, or decide existing personas already cover the offer.
- Success shapes:
  {"status":"persona","persona":{"id":"slug-id","label":"Short label","role":"…","industry_or_context":"…","demographics":"…","buying_behavior":"…","avatar":{"fears":["…"],"internal_dialogue":"…","objections":["…"],"aspirational_identity":"…"}}}
  {"status":"none","reason":"short plain-English reason"}
- persona.id must be a unique kebab-case slug (letters, numbers, hyphens). Never reuse an existing id.
- persona.role must be non-empty and meaningfully different from existing roles (not a rename/paraphrase).
- avatar.fears and avatar.objections must be non-empty arrays (≥1 item each).
- avatar.internal_dialogue must be a first-person thought (non-empty).
- Optional fields may be omitted.
- When existing personas already cover who_its_for, return status "none" with a brief reason.
- Prefer quality over quantity: do not invent a weak near-duplicate.`;

function stripCodeFences(content: string): string {
  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }
  return cleaned;
}

export function parseGeneratePersonaResult(raw: string): GeneratePersonaResult {
  const cleaned = stripCodeFences(raw);
  if (!cleaned) {
    throw new Error("AI returned an empty persona proposal");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      err instanceof Error
        ? `AI returned invalid JSON: ${err.message}`
        : "AI returned invalid JSON",
    );
  }
  const result = generatePersonaResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`AI returned invalid persona proposal: ${result.error.issues[0]?.message ?? "validation failed"}`);
  }
  return result.data;
}

export function buildGeneratePersonaUserPrompt(input: GeneratePersonaInput): string {
  const offer = input.offer;
  const parts = [
    input.slug?.trim() ? `Product slug: ${input.slug.trim()}` : "Product slug: (unknown)",
    "",
    "Offer:",
    `- one_liner: ${offer.one_liner.trim()}`,
    `- who_its_for: ${offer.who_its_for.trim()}`,
  ];
  if (offer.who_its_not_for?.trim()) {
    parts.push(`- who_its_not_for: ${offer.who_its_not_for.trim()}`);
  }

  parts.push("", `Existing personas (${input.existingPersonas.length}):`);
  if (input.existingPersonas.length === 0) {
    parts.push("(none — propose the first persona if the offer is clear)");
  } else {
    for (const p of input.existingPersonas) {
      const label = p.label?.trim() ? ` ("${p.label.trim()}")` : "";
      parts.push(`- id=${p.id} role=${p.role}${label}`);
      if (p.industry_or_context?.trim()) parts.push(`  industry_or_context: ${p.industry_or_context.trim()}`);
      if (p.demographics?.trim()) parts.push(`  demographics: ${p.demographics.trim()}`);
      if (p.buying_behavior?.trim()) parts.push(`  buying_behavior: ${p.buying_behavior.trim()}`);
      const fears = p.avatar?.fears?.filter(Boolean) ?? [];
      const objections = p.avatar?.objections?.filter(Boolean) ?? [];
      if (fears.length) parts.push(`  fears: ${fears.slice(0, 5).join("; ")}`);
      if (p.avatar?.internal_dialogue?.trim()) {
        parts.push(`  internal_dialogue: ${p.avatar.internal_dialogue.trim().slice(0, 200)}`);
      }
      if (objections.length) parts.push(`  objections: ${objections.slice(0, 5).join("; ")}`);
    }
  }

  parts.push(
    "",
    "Propose one additional distinct persona JSON, or status none if coverage is already enough.",
  );
  return parts.join("\n");
}

function validateInput(input: GeneratePersonaInput): GeneratePersonaInput {
  const one_liner = input.offer?.one_liner?.trim() ?? "";
  const who_its_for = input.offer?.who_its_for?.trim() ?? "";
  if (!one_liner) {
    throw new Error("offer.one_liner must be a non-empty string");
  }
  if (!who_its_for) {
    throw new Error("offer.who_its_for must be a non-empty string");
  }
  if (!Array.isArray(input.existingPersonas)) {
    throw new Error("existingPersonas must be an array");
  }
  return {
    slug: input.slug?.trim() || undefined,
    offer: {
      one_liner,
      who_its_for,
      ...(input.offer.who_its_not_for?.trim()
        ? { who_its_not_for: input.offer.who_its_not_for.trim() }
        : {}),
    },
    existingPersonas: input.existingPersonas,
  };
}

function ensureUniqueId(result: GeneratePersonaResult, existing: ExistingPersonaSummary[]): GeneratePersonaResult {
  if (result.status !== "persona") return result;
  const taken = new Set(
    existing.map((p) => p.id.trim().toLowerCase()).filter(Boolean),
  );
  const id = result.persona.id.trim();
  if (taken.has(id.toLowerCase())) {
    throw new Error(`AI proposed a duplicate persona id: ${id}`);
  }
  return result;
}

export async function generatePersona(input: GeneratePersonaInput): Promise<GeneratePersonaResult> {
  const validated = validateInput(input);
  const llm = getLLMService();
  const userPrompt = buildGeneratePersonaUserPrompt(validated);
  const llmOptions = {
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.4,
    maxTokens: 2048,
  };

  let raw: string;
  try {
    raw = await llm.complete(userPrompt, llmOptions);
  } catch (firstErr) {
    const message = firstErr instanceof Error ? firstErr.message : "";
    if (message.includes("Empty response from LLM")) {
      raw = await llm.complete(userPrompt, {
        ...llmOptions,
        model: DEFAULT_COMPLETION_MODEL,
        maxTokens: 3072,
      });
    } else {
      throw firstErr;
    }
  }

  const parsed = parseGeneratePersonaResult(raw);
  return ensureUniqueId(parsed, validated.existingPersonas);
}
