import { describe, expect, it } from "vitest";
import { isSlug, slugify, slugifyInput, slugKey } from "./slug";

/** Previous server/database.ts helper, kept here to prove database-derived slugs do not change. */
function legacyDatabaseSlugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

describe("slugify", () => {
  it("lowercases, strips accents and joins words with single hyphens", () => {
    expect(slugify("Cómo Instalar Python")).toBe("como-instalar-python");
    expect(slugify("  Año_2026 -- Guía  ")).toBe("ano-2026-guia");
    expect(slugify("How-to-print-in-javascript")).toBe("how-to-print-in-javascript");
    expect(slugify("que-es-x-")).toBe("que-es-x");
    expect(slugify("---")).toBe("");
  });

  it("applies maxLength as a plain slice", () => {
    expect(slugify("a".repeat(250), { maxLength: 200 })).toHaveLength(200);
  });

  it("matches the previous database helper on a sample of titles", () => {
    const samples = [
      "Full Stack Developer",
      "Bootcamp de Programación en Barcelona",
      "¿Qué es Manus IA?",
      "Data Science & ML — Part 2",
      "Ünïcödé   spaces__and--dashes",
      `${"Long title ".repeat(30)}end`,
    ];
    for (const s of samples) {
      expect(slugify(s, { maxLength: 200 })).toBe(legacyDatabaseSlugify(s));
    }
  });
});

describe("slugifyInput", () => {
  it("keeps one trailing hyphen while typing", () => {
    expect(slugifyInput("foo ")).toBe("foo-");
    expect(slugifyInput("-Foo--Bar")).toBe("foo-bar");
  });
});

describe("slugKey / isSlug", () => {
  it("gives every spelling of the same address the same key", () => {
    const k = slugKey("how-to-print-in-javascript");
    expect(slugKey("How-to-print-in-javascript")).toBe(k);
    expect(slugKey("HOW_TO_PRINT_IN_JAVASCRIPT")).toBe(k);
    expect(slugKey("how--to-print-in-javascript-")).toBe(k);
  });

  it("isSlug accepts only canonical slugs", () => {
    expect(isSlug("array-vacio-javascript")).toBe(true);
    expect(isSlug("a1")).toBe(true);
    expect(isSlug("How-to-print")).toBe(false);
    expect(isSlug("trailing-")).toBe(false);
    expect(isSlug("double--hyphen")).toBe(false);
    expect(isSlug("")).toBe(false);
  });
});
