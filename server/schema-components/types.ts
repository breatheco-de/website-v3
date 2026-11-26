/**
 * Schema components: section types that contribute schema.org JSON-LD during SSR.
 *
 * Contributors are plain server-side functions keyed by section `type` — React
 * components and `SectionRenderer` are never involved. Registry `schema.yml`
 * files may carry an advisory `schema_org.handler` field for discovery/docs,
 * but the executable mapping lives in `server/schema-components/index.ts`.
 */

export interface SchemaComponentContext {
  locale: string;
  contentRoot: string;
  baseUrl: string;
  /** Set when rendering a location detail page (enables location-scoped FAQs). */
  locationSlug?: string;
  /** Set when rendering a program detail page (prioritizes program-tagged FAQs). */
  programSlug?: string;
  /** Content type of the page (blog → BlogPosting, else Article for article bodies). */
  contentType?: string;
  /** Canonical page URL for Article/BlogPosting. */
  pageUrl?: string;
  title?: string;
  description?: string;
  image?: string;
  publishedAt?: string;
  updatedAt?: string;
  authorName?: string;
  /**
   * Hydrated relation authors (object[]) or legacy string name.
   * When present, BlogPosting/Article `author` becomes Person[] with url/@id.
   */
  authors?: Array<Record<string, unknown> | string>;
  /** Resolved single-entry bag (for mapping warnings, etc.). */
  singleEntry?: Record<string, unknown>;
}

export type SchemaContribution =
  /** Accumulated across all FAQ sections on the page, deduped, and emitted as one FAQPage. */
  | { kind: "faq-items"; items: Array<{ question: string; answer: string }> }
  /** Accumulated article bodies → one Article or BlogPosting. */
  | { kind: "article-bodies"; bodies: string[] }
  /** A standalone JSON-LD document, deduped by `dedupeKey` (defaults to its JSON serialization). */
  | {
      kind: "document";
      schema: Record<string, unknown>;
      dedupeKey?: string;
      source?: "faq" | "article" | "breadcrumb" | "schema_org" | "organization" | "website";
      needsStandaloneOrganization?: boolean;
    }
  /** Request dual-emit of site Organization (deduped by @id). */
  | { kind: "standalone-organization"; organizationId: string }
  /** Request dual-emit of site WebSite (deduped by @id). */
  | { kind: "standalone-website"; websiteId: string };

export type SchemaComponentContributor = (
  section: Record<string, unknown>,
  context: SchemaComponentContext,
) => SchemaContribution[];

/** Preview document with source badge for get_entry_seo / Schema tab. */
export interface SchemaOrgPreviewDocument {
  schema: Record<string, unknown>;
  source: "faq" | "article" | "breadcrumb" | "schema_org" | "organization" | "website";
}
