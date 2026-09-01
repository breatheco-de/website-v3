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
});
