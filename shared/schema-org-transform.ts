/**
 * Pure snake_case → schema.org JSON-LD key transform (locale overlays).
 * Shared by SSR (`server/schema-org`) and the schema_org Props preview editor.
 */

export type SchemaLocales = {
  [locale: string]: Record<string, unknown>;
};

const KEY_MAPPINGS: Record<string, string> = {
  type: "@type",
  same_as: "sameAs",
  aggregate_rating: "aggregateRating",
  rating_value: "ratingValue",
  review_count: "reviewCount",
  best_rating: "bestRating",
  worst_rating: "worstRating",
  contact_point: "contactPoint",
  contact_type: "contactType",
  address_country: "addressCountry",
  founding_date: "foundingDate",
  search_action: "potentialAction",
  query_input: "query-input",
  educational_level: "educationalLevel",
  time_required: "timeRequired",
  item_list_order: "itemListOrder",
  item_list_element: "itemListElement",
  parent_organization: "parentOrganization",
  street_address: "streetAddress",
  address_locality: "addressLocality",
  address_region: "addressRegion",
  postal_code: "postalCode",
  additional_type: "additionalType",
  price_range: "priceRange",
  payment_accepted: "paymentAccepted",
  opening_hours_specification: "openingHoursSpecification",
  day_of_week: "dayOfWeek",
  job_title: "jobTitle",
  works_for: "worksFor",
  knows_about: "knowsAbout",
  area_served: "areaServed",
  knows_language: "knowsLanguage",
};

export function camelToJsonLd(key: string): string {
  return KEY_MAPPINGS[key] || key;
}

/** Transform snake_case schema.yml / section properties into JSON-LD keys. */
export function transformToJsonLd(
  obj: Record<string, unknown>,
  locale: string = "en",
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key === "locales") continue;

    const jsonLdKey = camelToJsonLd(key);

    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (key === "search_action") {
        result["potentialAction"] = {
          "@type": "SearchAction",
          target: (value as Record<string, unknown>).target,
          "query-input": (value as Record<string, unknown>).query_input,
        };
      } else if (key === "aggregate_rating") {
        result["aggregateRating"] = {
          "@type": "AggregateRating",
          ...transformToJsonLd(value as Record<string, unknown>, locale),
        };
      } else if (key === "contact_point") {
        result["contactPoint"] = {
          "@type": "ContactPoint",
          ...transformToJsonLd(value as Record<string, unknown>, locale),
        };
      } else if (key === "address") {
        result["address"] = {
          "@type": "PostalAddress",
          ...transformToJsonLd(value as Record<string, unknown>, locale),
        };
      } else {
        result[jsonLdKey] = transformToJsonLd(value as Record<string, unknown>, locale);
      }
    } else if (Array.isArray(value)) {
      if (key === "founders") {
        result["founder"] = value.map((f: { name: string }) => ({
          "@type": "Person",
          name: f.name,
        }));
      } else if (key === "items" && (value[0] as { ref?: unknown } | undefined)?.ref) {
        result["itemListElement"] = value;
      } else {
        result[jsonLdKey] = value.map((item: unknown) => {
          if (item && typeof item === "object" && !Array.isArray(item)) {
            return transformToJsonLd(item as Record<string, unknown>, locale);
          }
          return item;
        });
      }
    } else {
      result[jsonLdKey] = value;
    }
  }

  const locales = obj.locales as SchemaLocales | undefined;
  if (locales && locales[locale]) {
    for (const [key, value] of Object.entries(locales[locale])) {
      const jsonLdKey = camelToJsonLd(key);
      result[jsonLdKey] = value;
    }
  }

  return result;
}

/** Build the JSON-LD document preview for a schema_org section. */
export function buildSchemaOrgPreviewDocument(
  schemaType: string,
  properties: Record<string, unknown>,
  locale: string = "en",
): Record<string, unknown> {
  const transformed = transformToJsonLd(properties, locale);
  transformed["@type"] = schemaType;
  return {
    "@context": "https://schema.org",
    ...transformed,
  };
}
