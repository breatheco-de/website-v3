/**
 * Product audience brief on entry `_product.yml` — offer + personas (avatar nested).
 * Locale-agnostic; agents translate when writing pages.
 */

export type ProductOffer = {
  one_liner: string;
  who_its_for: string;
  who_its_not_for?: string;
  outcomes?: string[];
  differentiators?: string[];
};

export type ProductPersonaAvatar = {
  fears: string[];
  internal_dialogue: string;
  objections: string[];
  aspirational_identity?: string;
  jobs_to_be_done?: string[];
};

export type ProductPersona = {
  id: string;
  label?: string;
  role: string;
  industry_or_context?: string;
  demographics?: string;
  buying_behavior?: string;
  decision_criteria?: string[];
  avatar: ProductPersonaAvatar;
};

export type ProductAudience = {
  offer: ProductOffer;
  personas: ProductPersona[];
};

export type AudienceStatus = "missing" | "minimal" | "complete";

function trimStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function trimStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseAvatar(raw: unknown): ProductPersonaAvatar | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const fears = trimStringList(o.fears);
  const objections = trimStringList(o.objections);
  const internal_dialogue = trimStr(o.internal_dialogue);
  const aspirational_identity = trimStr(o.aspirational_identity) || undefined;
  const jobs = trimStringList(o.jobs_to_be_done);
  return {
    fears,
    internal_dialogue,
    objections,
    ...(aspirational_identity ? { aspirational_identity } : {}),
    ...(jobs.length ? { jobs_to_be_done: jobs } : {}),
  };
}

function parsePersona(raw: unknown): ProductPersona | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const id = trimStr(o.id);
  const role = trimStr(o.role);
  if (!id || !role) return null;
  const avatar = parseAvatar(o.avatar);
  if (!avatar) return null;
  const label = trimStr(o.label) || undefined;
  const industry_or_context = trimStr(o.industry_or_context) || undefined;
  const demographics = trimStr(o.demographics) || undefined;
  const buying_behavior = trimStr(o.buying_behavior) || undefined;
  const decision_criteria = trimStringList(o.decision_criteria);
  return {
    id,
    role,
    avatar,
    ...(label ? { label } : {}),
    ...(industry_or_context ? { industry_or_context } : {}),
    ...(demographics ? { demographics } : {}),
    ...(buying_behavior ? { buying_behavior } : {}),
    ...(decision_criteria.length ? { decision_criteria } : {}),
  };
}

function parseOffer(raw: unknown): ProductOffer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const one_liner = trimStr(o.one_liner);
  const who_its_for = trimStr(o.who_its_for);
  if (!one_liner && !who_its_for) return null;
  const who_its_not_for = trimStr(o.who_its_not_for) || undefined;
  const outcomes = trimStringList(o.outcomes);
  const differentiators = trimStringList(o.differentiators);
  return {
    one_liner,
    who_its_for,
    ...(who_its_not_for ? { who_its_not_for } : {}),
    ...(outcomes.length ? { outcomes } : {}),
    ...(differentiators.length ? { differentiators } : {}),
  };
}

/** Normalize YAML/JSON into ProductAudience or null if unusable. */
export function parseProductAudience(raw: unknown): ProductAudience | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const offer = parseOffer(o.offer);
  const personasRaw = o.personas;
  const personas: ProductPersona[] = [];
  if (Array.isArray(personasRaw)) {
    for (const p of personasRaw) {
      const parsed = parsePersona(p);
      if (parsed) personas.push(parsed);
    }
  }
  if (!offer && personas.length === 0) return null;
  return {
    offer: offer ?? { one_liner: "", who_its_for: "" },
    personas,
  };
}

/** Extract audience fields from a full `_product.yml` document. */
export function parseAudienceFromProductDoc(doc: unknown): ProductAudience | null {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const o = doc as Record<string, unknown>;
  if (o.offer !== undefined || o.personas !== undefined) {
    return parseProductAudience({ offer: o.offer, personas: o.personas });
  }
  if (o.audience && typeof o.audience === "object") {
    return parseProductAudience(o.audience);
  }
  return null;
}

export function isPersonaMinimal(persona: ProductPersona): boolean {
  return (
    Boolean(persona.id?.trim()) &&
    Boolean(persona.role?.trim()) &&
    persona.avatar.fears.length >= 1 &&
    Boolean(persona.avatar.internal_dialogue?.trim()) &&
    persona.avatar.objections.length >= 1
  );
}

export function isMinimalProductAudience(raw: unknown): raw is ProductAudience {
  const a = parseProductAudience(raw);
  if (!a) return false;
  if (!a.offer.one_liner.trim() || !a.offer.who_its_for.trim()) return false;
  return a.personas.some(isPersonaMinimal);
}

export function audienceStatus(raw: unknown): AudienceStatus {
  const a = parseProductAudience(raw);
  if (!a || (!a.offer.one_liner && !a.offer.who_its_for && a.personas.length === 0)) {
    return "missing";
  }
  if (!isMinimalProductAudience(a)) return "missing";
  const complete =
    Boolean(a.offer.who_its_not_for?.trim()) &&
    a.personas.length >= 1 &&
    a.personas.every(
      (p) =>
        isPersonaMinimal(p) &&
        Boolean(p.avatar.aspirational_identity?.trim()) &&
        Boolean(p.industry_or_context?.trim()),
    );
  return complete ? "complete" : "minimal";
}

export function findPersonaById(
  audience: ProductAudience | null | undefined,
  personaId: string,
): ProductPersona | undefined {
  if (!audience || !personaId.trim()) return undefined;
  return audience.personas.find((p) => p.id === personaId.trim());
}

/** Serialize audience for writing into `_product.yml` (top-level offer + personas). */
export function audienceToYamlFields(audience: ProductAudience): {
  offer: ProductOffer;
  personas: ProductPersona[];
} {
  return {
    offer: audience.offer,
    personas: audience.personas,
  };
}
