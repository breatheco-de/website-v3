import {
  expandOrganizationRefs,
  getOrganizationId,
  transformToJsonLd,
} from "../schema-org";
import { isPageIdentitySchemaType } from "@shared/schema-org-page-url";
import type { SchemaComponentContributor, SchemaContribution } from "./types";
import { readEntryProduct } from "../product/product-io";
import { getVariableManager } from "../variable-manager";

/**
 * Emits one JSON-LD document from a schema_org section.
 * Marks `needsStandaloneOrganization` when `@organization` refs are expanded
 * so collectSectionSchemas can dual-emit the site Organization once.
 *
 * For Person and page-identity types (WebPage, AboutPage, …), fills `url` / `@id`
 * from `context.pageUrl` when missing. Typed values are emitted as-is.
 *
 * Course on a program page: when the product has pricing.list_price_variable and
 * that money resolves, injects offers (does not invent tuition).
 */
function attachCourseOfferFromProduct(
  doc: Record<string, unknown>,
  context: {
    locale: string;
    contentRoot: string;
    contentType?: string;
    programSlug?: string;
    pageUrl?: string;
  },
): void {
  if (doc["@type"] !== "Course" || doc.offers) return;
  const slug = context.programSlug?.trim();
  const ct = context.contentType === "programs" ? "program" : context.contentType;
  if (!slug || (ct !== "program" && context.contentType !== "programs")) return;

  const product = readEntryProduct("program", slug, context.contentRoot);
  let varName = product?.pricing?.list_price_variable?.trim() || "";
  // Fallback: list-role price var tagged to this program (when no product sidecar yet)
  if (!varName) {
    const defs = getVariableManager(context.contentRoot).getDefinitions();
    const candidates = Object.entries(defs).filter(([, def]) => {
      if (def.category !== "price" || def.price_role !== "list") return false;
      const products = Array.isArray(def.products) ? def.products : [];
      return products.length === 1 && products[0] === slug;
    });
    candidates.sort(([a], [b]) => {
      const score = (n: string) =>
        n.includes("price_full") || n.includes("full_tuition") ? 0 : 1;
      return score(a) - score(b) || a.localeCompare(b);
    });
    varName = candidates[0]?.[0] ?? "";
  }
  if (!varName) return;

  const money = getVariableManager(context.contentRoot).resolveMoneyValue(varName, {
    locale: context.locale,
  });
  if (!money) return;

  doc.offers = {
    "@type": "Offer",
    price: money.amount,
    priceCurrency: money.currency,
    availability: "https://schema.org/InStock",
    ...(context.pageUrl ? { url: context.pageUrl } : {}),
  };
}

export const contributeSchemaOrg: SchemaComponentContributor = (section, context) => {
  const schemaType = typeof section.schema_type === "string" ? section.schema_type.trim() : "";
  if (!schemaType) return [];

  const rawProps =
    section.properties && typeof section.properties === "object" && !Array.isArray(section.properties)
      ? (section.properties as Record<string, unknown>)
      : {};

  const transformed = transformToJsonLd(rawProps, context.locale);
  // Prefer explicit schema_type over nested `type` in properties.
  transformed["@type"] = schemaType;

  if ((schemaType === "Person" || isPageIdentitySchemaType(schemaType)) && context.pageUrl) {
    if (typeof transformed.url !== "string" || !transformed.url.trim()) {
      transformed.url = context.pageUrl;
    }
    if (typeof transformed["@id"] !== "string" || !String(transformed["@id"]).trim()) {
      transformed["@id"] =
        typeof transformed.url === "string" && transformed.url.trim()
          ? transformed.url
          : context.pageUrl;
    }
  }

  const doc: Record<string, unknown> = {
    "@context": "https://schema.org",
    ...transformed,
  };

  attachCourseOfferFromProduct(doc, context);

  const expanded = expandOrganizationRefs(doc, context.locale, context.contentRoot);
  const contributions: SchemaContribution[] = [
    {
      kind: "document",
      schema: doc,
      dedupeKey: `schema_org:${String(section.section_id ?? "")}:${schemaType}:${JSON.stringify(doc)}`,
      source: "schema_org",
      needsStandaloneOrganization: expanded,
    },
  ];

  if (expanded) {
    contributions.push({
      kind: "standalone-organization",
      organizationId: getOrganizationId(context.contentRoot),
    });
  }

  return contributions;
};
