/**
 * Component behavioral patterns declared on registry schema.yml.
 * Executable wiring stays in runtime layers (SSR schema-components, client trackEcommerce, etc.).
 */

export const COMPONENT_BEHAVIOR_IDS = [
  "ecommerce",
  "schema_org",
  "listing",
  "conversion",
] as const;

export type ComponentBehaviorId = (typeof COMPONENT_BEHAVIOR_IDS)[number];

export type EcommerceBehaviorRole = "funnel" | "catalog";

export interface EcommerceBehavior {
  role: EcommerceBehaviorRole;
  events: string[];
  notes?: string;
}

/** Companion section required when this component is present (e.g. hero course → Course). */
export interface SchemaOrgCompanionRequirement {
  /** Section type that must exist (typically `schema_org`). */
  companion_type: string;
  /** Required `schema_type` on that companion (e.g. `Course`). */
  schema_type: string;
  /** When set, requirement applies only if the declaring section's variant matches. */
  when_variant?: string;
}

export interface SchemaOrgBehavior {
  /** Contributor handler id (advisory; executable map is server/schema-components). */
  handler?: string;
  /** When set, validators require matching companion sections on the merged page. */
  requires?: SchemaOrgCompanionRequirement[];
  notes?: string;
}

export interface ListingBehavior {
  source: string;
  /** Advisory; see registry schema.yml for visitor search + dynamic_entries.search docs. */
  notes?: string;
}

export interface ConversionBehavior {
  via: string;
  notes?: string;
}

export interface ComponentBehaviors {
  ecommerce?: EcommerceBehavior;
  schema_org?: SchemaOrgBehavior;
  listing?: ListingBehavior;
  conversion?: ConversionBehavior;
}

/** Normalize schema.yml behaviors + legacy top-level schema_org. */
export function resolveComponentBehaviors(
  schema: Record<string, unknown> | null | undefined,
): ComponentBehaviors {
  const out: ComponentBehaviors = {};
  if (!schema || typeof schema !== "object") return out;

  const raw = schema.behaviors;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const b = raw as Record<string, unknown>;
    if (b.ecommerce && typeof b.ecommerce === "object") {
      out.ecommerce = b.ecommerce as EcommerceBehavior;
    }
    if (b.schema_org && typeof b.schema_org === "object") {
      const so = b.schema_org as SchemaOrgBehavior;
      out.schema_org = {
        ...(typeof so.handler === "string" ? { handler: so.handler } : {}),
        ...(Array.isArray(so.requires) ? { requires: so.requires } : {}),
        ...(typeof so.notes === "string" ? { notes: so.notes } : {}),
      };
    }
    if (b.listing && typeof b.listing === "object") {
      out.listing = b.listing as ListingBehavior;
    }
    if (b.conversion && typeof b.conversion === "object") {
      out.conversion = b.conversion as ConversionBehavior;
    }
  }

  // Legacy top-level schema_org → behaviors.schema_org
  if (!out.schema_org && schema.schema_org && typeof schema.schema_org === "object") {
    const legacy = schema.schema_org as { handler?: string; description?: string };
    if (typeof legacy.handler === "string") {
      out.schema_org = {
        handler: legacy.handler,
        notes: legacy.description,
      };
    }
  }

  return out;
}

export const CTA_TRACKING_VALUES = ["none", "add_to_cart", "click_begin_checkout"] as const;
export type CtaTrackingValue = (typeof CTA_TRACKING_VALUES)[number];

export function isCtaTrackingValue(v: unknown): v is CtaTrackingValue {
  return typeof v === "string" && (CTA_TRACKING_VALUES as readonly string[]).includes(v);
}

/** Infer tracking from CTA URL path (migration heuristics only). */
export function inferCtaTrackingFromUrl(url: unknown): CtaTrackingValue {
  if (typeof url !== "string") return "none";
  const lower = url.toLowerCase();
  if (lower.includes("/checkout")) return "click_begin_checkout";
  if (lower.includes("/payment-component")) return "add_to_cart";
  return "none";
}
