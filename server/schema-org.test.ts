import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSchemaCache,
  expandOrganizationRefs,
  getOrganizationDocument,
  getOrganizationNestedRef,
} from "./schema-org";

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
