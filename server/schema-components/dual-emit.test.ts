import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSchemaCache } from "../schema-org";
import { collectSectionSchemasDetailed } from "./index";

describe("schema_org @organization dual-emit", () => {
  let contentRoot: string;

  beforeEach(() => {
    contentRoot = fs.mkdtempSync(path.join(os.tmpdir(), "schema-org-dual-"));
    fs.writeFileSync(
      path.join(contentRoot, "schema-org.yml"),
      `organization:
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
`,
      "utf-8",
    );
    clearSchemaCache(contentRoot);
  });

  afterEach(() => {
    clearSchemaCache(contentRoot);
    fs.rmSync(contentRoot, { recursive: true, force: true });
  });

  it("expands nested Organization and emits one standalone Organization", () => {
    const { documents, preview } = collectSectionSchemasDetailed(
      [
        {
          type: "schema_org",
          schema_type: "Course",
          section_id: "c1",
          properties: {
            name: "Course A",
            provider: "@organization",
          },
        },
        {
          type: "schema_org",
          schema_type: "LocalBusiness",
          section_id: "lb1",
          properties: {
            name: "Campus",
            parent_organization: "@organization",
          },
        },
      ],
      {
        locale: "en",
        contentRoot,
        baseUrl: "https://example.org",
      },
    );

    const courses = documents.filter((d) => d["@type"] === "Course");
    const orgs = documents.filter(
      (d) =>
        d["@type"] === "EducationalOrganization" ||
        (Array.isArray(d["@type"]) && (d["@type"] as string[]).includes("EducationalOrganization")),
    );
    // transform sets @type from organization.type
    const standaloneOrgs = documents.filter((d) => d["@id"] === "https://example.org/#organization");

    expect(courses).toHaveLength(1);
    expect((courses[0].provider as Record<string, unknown>)["@id"]).toBe(
      "https://example.org/#organization",
    );
    expect((courses[0].provider as Record<string, unknown>).aggregateRating).toBeUndefined();
    expect((courses[0].provider as Record<string, unknown>).name).toBe("Test Org");

    const localBusiness = documents.find((d) => d["@type"] === "LocalBusiness");
    expect(localBusiness).toBeDefined();
    const parentOrg = localBusiness?.parentOrganization as Record<string, unknown>;
    expect(parentOrg["@id"]).toBe("https://example.org/#organization");
    expect(parentOrg.aggregateRating).toBeUndefined();

    expect(standaloneOrgs).toHaveLength(1);
    expect(standaloneOrgs[0].aggregateRating).toEqual({
      "@type": "AggregateRating",
      ratingValue: 4.5,
      reviewCount: 2500,
      bestRating: 5,
      worstRating: 1,
    });
    expect(preview.filter((p) => p.source === "organization")).toHaveLength(1);
    expect(orgs.length + standaloneOrgs.length).toBeGreaterThanOrEqual(1);

    const aggregateRatingCount = JSON.stringify(documents).match(/aggregateRating/g)?.length ?? 0;
    expect(aggregateRatingCount).toBe(1);
  });

  const ctx = () => ({ locale: "en", contentRoot, baseUrl: "https://example.org" });

  it("expands @website into a nested ref and emits one standalone WebSite", () => {
    const { documents, preview } = collectSectionSchemasDetailed(
      [
        {
          type: "schema_org",
          schema_type: "WebPage",
          section_id: "wp1",
          properties: { name: "Home", isPartOf: "@website", publisher: "@organization" },
        },
        {
          type: "schema_org",
          schema_type: "WebPage",
          section_id: "wp2",
          properties: { name: "Other", isPartOf: "@website" },
        },
      ],
      ctx(),
    );

    const page = documents.find((d) => d.name === "Home")!;
    expect(page.isPartOf).toEqual({
      "@id": "https://example.org/#website",
      "@type": "WebSite",
      name: "Test Site",
      url: "https://example.org",
    });
    expect((page.publisher as Record<string, unknown>)["@id"]).toBe("https://example.org/#organization");

    const sites = documents.filter((d) => d["@id"] === "https://example.org/#website");
    expect(sites).toHaveLength(1);
    expect(sites[0]["@type"]).toBe("WebSite");
    expect(preview.filter((p) => p.source === "website")).toHaveLength(1);
    expect(documents.filter((d) => d["@id"] === "https://example.org/#organization")).toHaveLength(1);
  });

  it("leaves unknown @-strings and pages without refs alone", () => {
    const { documents } = collectSectionSchemasDetailed(
      [{ type: "schema_org", schema_type: "WebPage", section_id: "wp", properties: { name: "Plain" } }],
      ctx(),
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]["@type"]).toBe("WebPage");
  });

  it("uses schema-org.yml Organization as base when a section carries its @id", () => {
    const { documents, preview } = collectSectionSchemasDetailed(
      [
        {
          type: "schema_org",
          schema_type: "WebPage",
          section_id: "wp",
          properties: { name: "Home", publisher: "@organization" },
        },
        {
          type: "schema_org",
          schema_type: "Organization",
          section_id: "org",
          properties: {
            "@id": "https://example.org/#organization",
            same_as: ["https://a.example", "https://b.example"],
          },
        },
      ],
      ctx(),
    );

    const orgs = documents.filter((d) => d["@id"] === "https://example.org/#organization");
    expect(orgs).toHaveLength(1);
    expect(orgs[0]["@type"]).toBe("EducationalOrganization");
    expect(orgs[0].name).toBe("Test Org");
    expect(orgs[0].sameAs).toEqual(["https://a.example", "https://b.example"]);
    expect(orgs[0].aggregateRating).toBeDefined();
    // the section document is the Organization; no second standalone copy
    expect(preview.filter((p) => p.source === "organization")).toHaveLength(0);
  });

  it("lets properties.type override the site type on a based section", () => {
    const { documents } = collectSectionSchemasDetailed(
      [
        {
          type: "schema_org",
          schema_type: "Organization",
          section_id: "org",
          properties: { "@id": "https://example.org/#organization", type: "Organization", name: "Override" },
        },
      ],
      ctx(),
    );
    expect(documents[0]["@type"]).toBe("Organization");
    expect(documents[0].name).toBe("Override");
    expect(documents[0].url).toBe("https://example.org");
  });

  it("uses schema-org.yml WebSite as base when a section carries its @id", () => {
    const { documents } = collectSectionSchemasDetailed(
      [
        {
          type: "schema_org",
          schema_type: "WebSite",
          section_id: "ws",
          properties: { "@id": "https://example.org/#website", description: "Custom" },
        },
        {
          type: "schema_org",
          schema_type: "WebPage",
          section_id: "wp",
          properties: { name: "Home", isPartOf: "@website" },
        },
      ],
      ctx(),
    );
    const sites = documents.filter((d) => d["@id"] === "https://example.org/#website");
    expect(sites).toHaveLength(1);
    expect(sites[0]).toMatchObject({ "@type": "WebSite", name: "Test Site", description: "Custom" });
  });

  it("does not base a section whose @id is some other value", () => {
    const { documents } = collectSectionSchemasDetailed(
      [
        {
          type: "schema_org",
          schema_type: "Organization",
          section_id: "org",
          properties: { "@id": "https://partner.example/#organization", name: "Partner" },
        },
      ],
      ctx(),
    );
    expect(documents).toHaveLength(1);
    expect(documents[0]).toEqual({
      "@context": "https://schema.org",
      "@id": "https://partner.example/#organization",
      "@type": "Organization",
      name: "Partner",
    });
  });
});
