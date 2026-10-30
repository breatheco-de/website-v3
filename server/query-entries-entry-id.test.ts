import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const purchasableFor = new Set<string>(["javascript-empty-array"]);
vi.mock("./ecommerce/ecommerce-manager", () => ({
  applyPurchasableToRecord: (record: Record<string, unknown>, _contentType: string, slug: string) => {
    record._purchasable = purchasableFor.has(slug);
    record._product_ref = slug;
  },
}));

import { ContentIndex } from "./content-index";
import { resetRegistry } from "./content-types";
import { queryEntries } from "./query-entries";
import { invalidateStaticListingCache } from "./static-listing-cache";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  resetRegistry();
});

describe("static listing identity", () => {
  it("gives every language row the page ID and the same product identity", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "query-entry-id-"));
    tmpDirs.push(root);
    write(
      root,
      "content-types.yml",
      "how-to:\n  directory: how-to\n  url_pattern:\n    en: /en/how-to/:slug\n    es: /es/how-to/:slug\n",
    );
    write(root, "how-to/javascript-empty-array/_common.yml", "slug: javascript-empty-array\n");
    write(root, "how-to/javascript-empty-array/en.yml", "title: Empty array\n");
    write(root, "how-to/javascript-empty-array/es.yml", "slug: array-vacio-javascript\ntitle: Array vacío\n");
    const ci = new ContentIndex(root);
    resetRegistry();
    ci.scanFast();
    invalidateStaticListingCache(undefined, root);

    const { items } = await queryEntries({ from: { contentType: "how-to" } }, { contentIndex: ci, contentRoot: root });
    const rows = items as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.slug).sort()).toEqual(["array-vacio-javascript", "javascript-empty-array"]);
    for (const r of rows) {
      expect(r.entry_id).toBe("javascript-empty-array");
      expect(r._product_ref).toBe("javascript-empty-array");
      expect(r._purchasable).toBe(true);
    }
  });
});
