import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "./database";
import { resolveTestimonialsSectionPreview } from "./testimonials-section-preview";
import {
  TESTIMONIALS_LIMIT_DEFAULTS,
  testimonialIgnoreIdentity,
  testimonialItemKey,
} from "@shared/testimonials-listing";

let tempDir: string;
let contentRoot: string;
let db: DatabaseManager;

function writeTestimonialsFixture() {
  const dbDir = path.join(contentRoot, "db", "testimonials");
  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(
    path.join(dbDir, "config.yml"),
    yaml.dump({
      name: "Testimonials",
      source: { type: "local", local: { filename: "testimonials.yml" } },
      filter_by_locale: true,
      field_mapping: {
        locale: "locale",
        student_name: "student_name",
        student_thumb: "student_thumb",
        excerpt: "excerpt",
        related_features: "related_features",
        priority: "priority",
        slug: "slug",
      },
    }),
    "utf-8",
  );

  const rows = [
    {
      locale: "es",
      student_name: "Ana Con Foto",
      student_thumb: "https://example.com/ana.jpg",
      excerpt: "Excelente bootcamp",
      priority: 1,
      related_features: ["career-change"],
    },
    {
      locale: "es",
      student_name: "Bruno Sin Foto",
      excerpt: "Solo texto",
      priority: 1,
    },
    {
      locale: "es",
      slug: "carlos-oculto",
      student_name: "Carlos Oculto",
      student_thumb: "https://example.com/carlos.jpg",
      excerpt: "Ocultar en preview",
      priority: 1,
    },
    {
      locale: "es",
      student_name: "Diana Topic",
      student_thumb: "https://example.com/diana.jpg",
      excerpt: "Solo topic ai",
      priority: 1,
      related_features: ["ai-engineering"],
    },
    {
      locale: "en",
      student_name: "English Only",
      student_thumb: "https://example.com/en.jpg",
      excerpt: "Wrong locale",
      priority: 1,
    },
  ];

  fs.writeFileSync(path.join(dbDir, "testimonials.yml"), yaml.dump(rows), "utf-8");
}

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "testimonials-preview-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  writeTestimonialsFixture();
  db = new DatabaseManager(contentRoot);
  db.reload();
  await db.fetchItems("testimonials", true);
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("resolveTestimonialsSectionPreview", () => {
  it("returns slide-valid ES rows with photo (excludes no-thumb rows)", async () => {
    const result = await resolveTestimonialsSectionPreview({
      sectionType: "testimonials_slide",
      locale: "es",
      dynamicEntries: { database: "testimonials" },
      contentRoot,
      db,
    });

    const names = result.items.map((r) => r.student_name);
    expect(names).toContain("Ana Con Foto");
    expect(names).toContain("Carlos Oculto");
    expect(names).toContain("Diana Topic");
    expect(names).not.toContain("Bruno Sin Foto");
    expect(names).not.toContain("English Only");
    expect(result.total).toBeGreaterThanOrEqual(3);
    expect(result.total).toBeLessThanOrEqual(TESTIMONIALS_LIMIT_DEFAULTS.testimonials_slide);
  });

  it("drops a row when ignored_entries contains its identity", async () => {
    const hiddenKey = testimonialIgnoreIdentity({
      slug: "carlos-oculto",
      student_name: "Carlos Oculto",
    });

    const result = await resolveTestimonialsSectionPreview({
      sectionType: "testimonials_slide",
      locale: "es",
      dynamicEntries: {
        database: "testimonials",
        ignored_entries: [hiddenKey],
      },
      contentRoot,
      db,
    });

    expect(result.items.some((r) => r.student_name === "Carlos Oculto")).toBe(false);
  });

  it("narrows results with permanent_filters topics", async () => {
    const result = await resolveTestimonialsSectionPreview({
      sectionType: "testimonials_slide",
      locale: "es",
      dynamicEntries: {
        database: "testimonials",
        permanent_filters: [
          { item_property_slug: "related_features", value: ["career-change"] },
        ],
      },
      contentRoot,
      db,
    });

    expect(result.items.map((r) => r.student_name)).toEqual(["Ana Con Foto"]);
  });

  it("matches ignored_entries by normalized student name key", async () => {
    const nameKey = testimonialItemKey("Ana Con Foto");

    const result = await resolveTestimonialsSectionPreview({
      sectionType: "testimonials_slide",
      locale: "es",
      dynamicEntries: {
        database: "testimonials",
        ignored_entries: [nameKey],
      },
      contentRoot,
      db,
    });

    expect(result.items.some((r) => r.student_name === "Ana Con Foto")).toBe(false);
  });
});
