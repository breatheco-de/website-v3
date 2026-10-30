import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentIndex } from "../../../server/content-index";
import { resetRegistry } from "../../../server/content-types";
import type { ContentFile, ValidationContext } from "../shared/types";
import { slugIdentityValidator } from "./slug-identity";

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

function file(type: string, slug: string, root: string): ContentFile {
  return { type, slug, locale: "en", title: slug, filePath: path.join(root, type, slug, "en.yml") };
}

function context(ci: ContentIndex, files: ContentFile[]): ValidationContext {
  return {
    contentRoot: ci.contentRoot,
    contentIndex: ci,
    contentFiles: files,
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
  };
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  resetRegistry();
});

describe("slugIdentityValidator", () => {
  it("flags non-slug IDs, a differing shared slug and key collisions", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "slug-identity-"));
    tmpDirs.push(root);
    write(root, "content-types.yml", "how-to:\n  directory: how-to\n  url_pattern:\n    en: /en/how-to/:slug\n");
    write(root, "how-to/How-to-print-in-javascript/_common.yml", "slug: how-to-print-in-javascript\n");
    write(root, "how-to/How-to-print-in-javascript/en.yml", "title: Print\n");
    write(root, "how-to/stale-common/_common.yml", "slug: old-address\n");
    write(root, "how-to/stale-common/en.yml", "slug: stale-common\ntitle: Stale\n");
    write(root, "how-to/clean-page/en.yml", "title: Clean\n");
    write(root, "how-to/dup-a/en.yml", "slug: same-address\n");
    write(root, "how-to/dup-b/en.yml", "slug: Same_Address\n");
    const ci = new ContentIndex(root);
    resetRegistry();
    ci.scanFast();

    const result = await slugIdentityValidator.run(
      context(ci, [
        file("how-to", "How-to-print-in-javascript", root),
        file("how-to", "stale-common", root),
        file("how-to", "clean-page", root),
        file("how-to", "dup-a", root),
      ]),
    );
    const byCode = (code: string) => result.warnings.filter((w) => w.code === code).map((w) => w.message.split(":")[0]);
    expect(byCode("ENTRY_ID_NOT_SLUG")).toEqual(["how-to/How-to-print-in-javascript"]);
    // A lowercase spelling of a mixed-case ID is not flagged; a different address is.
    expect(byCode("COMMON_SLUG_DIFFERS_FROM_ID")).toEqual(["how-to/stale-common"]);
    expect(byCode("SLUG_KEY_COLLISION")).toHaveLength(1);
    expect(result.warnings.find((w) => w.code === "SLUG_KEY_COLLISION")?.message).toContain("dup-a, dup-b");
  });

  it("passes a clean page", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "slug-identity-"));
    tmpDirs.push(root);
    write(root, "content-types.yml", "how-to:\n  directory: how-to\n  url_pattern:\n    en: /en/how-to/:slug\n");
    write(root, "how-to/clean-page/_common.yml", "slug: clean-page\n");
    write(root, "how-to/clean-page/en.yml", "title: Clean\n");
    const ci = new ContentIndex(root);
    resetRegistry();
    ci.scanFast();
    const result = await slugIdentityValidator.run(context(ci, [file("how-to", "clean-page", root)]));
    expect(result.status).toBe("passed");
  });
});
