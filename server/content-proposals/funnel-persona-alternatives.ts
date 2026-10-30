/**
 * Non-blocking reminder on funnel proposals: list every persona on each bound product so the author
 * picks the one this page talks to, not the one sibling pages use.
 */

import { normalizeFunnelProducts, type FunnelProductBinding } from "@shared/funnel";
import type { FunnelPersonaChoice } from "../product/funnel-audience-gates";

export const FUNNEL_PERSONA_ALTERNATIVES = "funnel_persona_alternatives";

type EntryLike = {
  contentType: string;
  slug: string;
  updates?: Array<{ field_path: string; value?: unknown; reset?: boolean }>;
};

export type FunnelPersonaAlternativesWarning = {
  code: typeof FUNNEL_PERSONA_ALTERNATIVES;
  message: string;
  details: {
    products: Array<{
      product: string;
      chosen_personas: string[];
      entries: string[];
      personas: FunnelPersonaChoice[];
    }>;
  };
};

function bindingsFromUpdate(u: { field_path: string; value?: unknown; reset?: boolean }): FunnelProductBinding[] {
  if (u.reset) return [];
  let raw: unknown;
  if (u.field_path === "funnel.products") raw = u.value;
  else if (u.field_path === "funnel" && u.value && typeof u.value === "object" && !Array.isArray(u.value)) {
    raw = (u.value as Record<string, unknown>).products;
  } else return [];
  const products = normalizeFunnelProducts(raw);
  return Array.isArray(products) ? products : [];
}

export function funnelPersonaAlternativesWarning(
  entries: EntryLike[],
  personasFor: (productSlug: string) => FunnelPersonaChoice[] | null,
): FunnelPersonaAlternativesWarning | null {
  const byProduct = new Map<string, { chosen: Set<string>; entries: Set<string> }>();
  for (const entry of entries) {
    for (const u of entry.updates ?? []) {
      for (const b of bindingsFromUpdate(u)) {
        const persona = b.persona?.trim();
        if (!persona) continue;
        const row = byProduct.get(b.product) ?? { chosen: new Set(), entries: new Set() };
        row.chosen.add(persona);
        row.entries.add(`${entry.contentType}/${entry.slug}`);
        byProduct.set(b.product, row);
      }
    }
  }
  const products: FunnelPersonaAlternativesWarning["details"]["products"] = [];
  byProduct.forEach((row, product) => {
    const personas = personasFor(product);
    if (!personas || personas.length < 2) return;
    products.push({
      product,
      chosen_personas: Array.from(row.chosen),
      entries: Array.from(row.entries),
      personas,
    });
  });
  if (products.length === 0) return null;
  const chosen = products
    .map((p) => `${p.product} → ${p.chosen_personas.join(", ")}`)
    .join("; ");
  return {
    code: FUNNEL_PERSONA_ALTERNATIVES,
    message:
      `Chosen persona(s): ${chosen}. Confirm each matches who this page talks to (title, hero, CTAs) — ` +
      `details.products[].personas lists every persona on the product with its role and routing context. ` +
      `Other pages using a persona is not evidence either way. Not a blocker; revise_entries if another persona fits better.`,
    details: { products },
  };
}
