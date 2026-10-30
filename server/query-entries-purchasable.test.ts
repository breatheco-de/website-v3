import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { invalidateStaticListingCache, queryEntries } from "./query-entries";

vi.mock("./ecommerce/ecommerce-manager", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ecommerce/ecommerce-manager")>();
  return {
    ...actual,
    applyPurchasableToRecord(
      record: Record<string, unknown>,
      _contentType: string,
      slug?: string,
    ) {
      // Product index keys products by the page ID (entry folder), like server/product/product-index.ts.
      const s = (slug || String(record.slug ?? "")).trim();
      record.purchasable = s === "ai-engineering-folder";
    },
  };
});

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let ci: ContentIndex;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "query-entries-purchasable-"));
  contentRoot = path.join(tempDir, "site_test");
  fs.mkdirSync(contentRoot, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `program:
  directory: programs
  field_mapping:
    slug: slug
    title: title
    bc_slug: bc_slug
    lang: lang
  url_pattern:
    en: /en/career-programs/:slug
    es: /es/programas-de-carrera/:slug
`,
    "utf-8",
  );

  const folder = path.join(contentRoot, "programs", "ai-engineering-folder");
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(
    path.join(folder, "_common.yml"),
    `slug: ai-engineering
bc_slug: ai-engineering
title: AI Engineering
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(folder, "en.yml"),
    `slug: ai-engineering
title: AI Engineering
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(folder, "es.yml"),
    `slug: ingenieria-ia
title: Ingeniería de Inteligencia Artificial
`,
    "utf-8",
  );

  const flex = path.join(contentRoot, "programs", "ai-flex");
  fs.mkdirSync(flex, { recursive: true });
  fs.writeFileSync(
    path.join(flex, "_common.yml"),
    `slug: ai-flex
bc_slug: ai-flex
title: AI Flex
`,
    "utf-8",
  );
  fs.writeFileSync(
    path.join(flex, "es.yml"),
    `slug: ai-flex
title: AI Flex
`,
    "utf-8",
  );

  process.chdir(tempDir);
  resetRegistry(contentRoot);
  invalidateStaticListingCache();
  ci = new ContentIndex(contentRoot);
  ci.scanFast();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  invalidateStaticListingCache();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("queryEntries purchasable vs locale URL slug", () => {
  it("keeps a translated URL slug purchasable using the page ID", async () => {
    const { items } = await queryEntries(
      {
        from: { contentType: "program" },
        locale: "es",
        filters: [{ field: "purchasable", value: "true" }],
      },
      { contentIndex: ci, contentRoot },
    );

    const engineering = items.find((i) => i.bc_slug === "ai-engineering");
    expect(engineering).toMatchObject({
      slug: "ingenieria-ia",
      bc_slug: "ai-engineering",
      title: "Ingeniería de Inteligencia Artificial",
      purchasable: true,
      entry_id: "ai-engineering-folder",
    });
    expect(engineering).not.toHaveProperty("_common_slug");
    expect(engineering).not.toHaveProperty("_entry_slug");
    expect(items.find((i) => i.slug === "ai-flex")).toBeUndefined();
  });

  it("still matches when the locale slug differs from the page ID", async () => {
    const { items } = await queryEntries(
      {
        from: { contentType: "program" },
        locale: "en",
        filters: [{ field: "purchasable", value: "true" }],
      },
      { contentIndex: ci, contentRoot },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      slug: "ai-engineering",
      bc_slug: "ai-engineering",
      purchasable: true,
    });
  });
});
