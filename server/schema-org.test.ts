import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSchemaCache,
  expandOrganizationRefs,
  getOrganizationDocument,
  getOrganizationLogo,
  getOrganizationName,
  getOrganizationNestedRef,
  getOrganizationSameAsUrl,
  getOrganizationTwitterHandle,
  getSchema,
  getWebsiteDefaultSocialImage,
  getWebsiteTemplateProperties,
  isSchemaOrgUsagePath,
  loadResolvedSchemaConfig,
} from "./schema-org";
import { resetVariableManagerCache } from "./variable-manager";

const SCHEMA_WITH_RATING = `organization:
  type: EducationalOrganization
  name: Test Org
  url: https://example.org
  aggregate_rating:
    rating_value: 4.5
    review_count: 2500
    best_rating: 5
    worst_rating: 1
website:
  type: WebSite
  name: Test Site
  url: https://example.org
`;

const SCHEMA_WITH_TOKENS = `organization:
  type: EducationalOrganization
  name: "{{ global.org_display_name }}"
  url: https://example.org
  logo: "{{ global.org_logo_url }}"
  same_as:
    - "{{ global.twitter_profile_url }}"
  aggregate_rating:
    rating_value: "{{ global.global_review_rating }}"
    review_count: "{{ global.global_review_count }}"
    best_rating: 5
    worst_rating: 1
website:
  type: WebSite
  name: "{{ global.site_display_name }}"
  url: https://example.org
  default_social_image: "{{ global.default_og_image }}"
`;

const VARIABLES_YML = `global.global_review_rating:
  default: "4.9"
global.global_review_count:
  default: "700+"
global.site_display_name:
  default: "Resolved Site Name"
global.org_display_name:
  default: "Resolved Org Name"
global.org_logo_url:
  default: "https://cdn.example.org/logo.png"
global.twitter_profile_url:
  default: "https://twitter.com/ResolvedHandle"
global.default_og_image:
  default: "https://cdn.example.org/og.png"
`;

describe("getOrganizationNestedRef", () => {
  let contentRoot: string;

  beforeEach(() => {
    contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "schema-org-nested-"));
    fs.writeFileSync(path.join(contentRoot, "schema-org.yml"), SCHEMA_WITH_RATING, "utf-8");
    clearSchemaCache(contentRoot);
  });

  afterEach(() => {
    clearSchemaCache(contentRoot);
    fs.rmSync(contentRoot, { recursive: true, force: true });
  });

  it("returns lightweight ref with @id and without aggregateRating", () => {
    const nested = getOrganizationNestedRef("en", contentRoot);
    expect(nested).toEqual({
      "@id": "https://example.org/#organization",
      "@type": "EducationalOrganization",
      name: "Test Org",
      url: "https://example.org",
    });
    expect(nested).not.toHaveProperty("aggregateRating");
  });

  it("full organization document still includes aggregateRating", () => {
    const full = getOrganizationDocument("en", contentRoot);
    expect(full?.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 2500,
      bestRating: 5,
      worstRating: 1,
    });
  });
});

describe("expandOrganizationRefs", () => {
  let contentRoot: string;

  beforeEach(() => {
    contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "schema-org-expand-"));
    fs.writeFileSync(path.join(contentRoot, "schema-org.yml"), SCHEMA_WITH_RATING, "utf-8");
    clearSchemaCache(contentRoot);
  });

  afterEach(() => {
    clearSchemaCache(contentRoot);
    fs.rmSync(contentRoot, { recursive: true, force: true });
  });

  it("inlines nested ref without aggregateRating", () => {
    const doc: Record<string, unknown> = {
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Campus",
      parentOrganization: "@organization",
    };

    const expanded = expandOrganizationRefs(doc, "en", contentRoot);
    expect(expanded).toBe(true);
    expect(doc.parentOrganization).toEqual({
      "@id": "https://example.org/#organization",
      "@type": "EducationalOrganization",
      name: "Test Org",
      url: "https://example.org",
    });
    expect(doc.parentOrganization).not.toHaveProperty("aggregateRating");
    expect(doc).not.toHaveProperty("aggregateRating");
  });
});

describe("isSchemaOrgUsagePath", () => {
  it("matches schema-org.yml at site root", () => {
    expect(isSchemaOrgUsagePath("site_4geeks-com/schema-org.yml")).toBe(true);
    expect(isSchemaOrgUsagePath("schema-org.yml")).toBe(true);
    expect(isSchemaOrgUsagePath("site_4geeks-com/blog/post/en.yml")).toBe(false);
  });
});

describe("loadResolvedSchemaConfig / getOrganizationDocument tokens", () => {
  let contentRoot: string;

  beforeEach(() => {
    contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "schema-org-vars-"));
    fs.writeFileSync(path.join(contentRoot, "schema-org.yml"), SCHEMA_WITH_TOKENS, "utf-8");
    fs.writeFileSync(path.join(contentRoot, "variables.yml"), VARIABLES_YML, "utf-8");
    clearSchemaCache(contentRoot);
    resetVariableManagerCache();
  });

  afterEach(() => {
    clearSchemaCache(contentRoot);
    resetVariableManagerCache();
    fs.rmSync(contentRoot, { recursive: true, force: true });
  });

  it("resolves global tokens across the loaded config", () => {
    const resolved = loadResolvedSchemaConfig(contentRoot, "en");
    expect(resolved.organization?.aggregate_rating).toEqual({
      rating_value: "4.9",
      review_count: "700+",
      best_rating: 5,
      worst_rating: 1,
    });
    expect(resolved.website?.name).toBe("Resolved Site Name");
  });

  it("emits resolved rating values in the organization JSON-LD", () => {
    const full = getOrganizationDocument("en", contentRoot);
    expect(full?.["@id"]).toBe("https://example.org/#organization");
    expect(full?.aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: "4.9",
      reviewCount: "700+",
      bestRating: 5,
      worstRating: 1,
    });
  });

  it("resolves website tokens via getSchema", () => {
    const website = getSchema("website", "en", contentRoot);
    expect(website?.name).toBe("Resolved Site Name");
    expect(website?.["@type"]).toBe("WebSite");
  });

  it("resolves site-chrome helpers used in SSR meta tags", () => {
    expect(getOrganizationName(contentRoot)).toBe("Resolved Org Name");
    expect(getOrganizationLogo(contentRoot)).toBe("https://cdn.example.org/logo.png");
    expect(getWebsiteDefaultSocialImage(contentRoot)).toBe("https://cdn.example.org/og.png");
    expect(getOrganizationSameAsUrl("twitter", contentRoot)).toBe(
      "https://twitter.com/ResolvedHandle",
    );
    expect(getOrganizationTwitterHandle(contentRoot)).toBe("@ResolvedHandle");
  });

  it("keeps prefills raw so editors can still see tokens", () => {
    const website = getWebsiteTemplateProperties("en", contentRoot);
    expect(website?.name).toBe("{{ global.site_display_name }}");
    expect(website?.default_social_image).toBeUndefined();
  });
});
