import { describe, expect, it } from "vitest";
import {
  buildSchemaOrgPreviewDocument,
  camelToJsonLd,
  transformToJsonLd,
} from "@shared/schema-org-transform";

describe("schema-org-transform", () => {
  it("maps Person snake_case keys to JSON-LD camelCase", () => {
    expect(camelToJsonLd("job_title")).toBe("jobTitle");
    expect(camelToJsonLd("works_for")).toBe("worksFor");
    expect(camelToJsonLd("knows_about")).toBe("knowsAbout");
    expect(camelToJsonLd("same_as")).toBe("sameAs");
    expect(camelToJsonLd("area_served")).toBe("areaServed");
    expect(camelToJsonLd("knows_language")).toBe("knowsLanguage");

    const doc = transformToJsonLd({
      name: "Ada",
      job_title: "Analyst",
      knows_about: ["math"],
      works_for: { type: "Organization", name: "Org" },
      same_as: ["https://example.com/ada"],
      area_served: ["United States", "Latin America", "Europe"],
      knows_language: ["en", "es"],
    });

    expect(doc).toMatchObject({
      name: "Ada",
      jobTitle: "Analyst",
      knowsAbout: ["math"],
      sameAs: ["https://example.com/ada"],
      worksFor: { "@type": "Organization", name: "Org" },
      areaServed: ["United States", "Latin America", "Europe"],
      knowsLanguage: ["en", "es"],
    });
  });

  it("buildSchemaOrgPreviewDocument sets @context and @type", () => {
    const preview = buildSchemaOrgPreviewDocument("Person", {
      name: "Ada",
      job_title: "Analyst",
    });
    expect(preview["@context"]).toBe("https://schema.org");
    expect(preview["@type"]).toBe("Person");
    expect(preview.name).toBe("Ada");
    expect(preview.jobTitle).toBe("Analyst");
  });
});
