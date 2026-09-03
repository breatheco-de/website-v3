import fs from "fs";
import os from "os";
import path from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./single-resolver", () => ({
  resolveSingleVars: (page: unknown) => page,
}));
vi.mock("./build-single-entry", () => ({
  buildSingleEntryFromContent: () => ({}),
}));
vi.mock("./content-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-types")>();
  return {
    ...actual,
    finalizeSingleEntryForTemplates: (x: unknown) => x,
    getContentTypeConfig: () => ({
      editor: {
        title: { required: true },
        description: { required: true },
      },
    }),
    getFolder: () => "landings",
    getAllDirectories: () => ["landings", "pages", "blog"],
  };
});
vi.mock("./shared-layout-entry", () => ({
  isEntryDetached: () => false,
  isSharedLayoutType: () => false,
  isTemplateVersioningSlug: () => false,
}));
vi.mock("./database-single-loader", () => ({
  mergeSingleTemplate: () => null,
}));
vi.mock("./utils/deepMerge", () => ({
  deepMerge: (a: object, b: object) => ({ ...a, ...b }),
}));
vi.mock("./schema-org-requirements", () => ({
  formatSchemaOrgCompanionGateError: () => null,
}));
vi.mock("./site-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./site-config")>();
  return {
    ...actual,
    getDefaultContentRoot: () => "/tmp/content-root",
  };
});

import {
  getCommonEditGateLocales,
  evaluateCommonContentLiveGate,
  liveSeoGateIntentFromOperations,
  touchedPathsFromOperations,
} from "./content-editor";
import { ContentIndex } from "./content-index";

describe("common content live SEO gate", () => {
  let tempRoot: string;
  let contentRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "common-gate-"));
    contentRoot = path.join(tempRoot, "site_test");
    const landingDir = path.join(contentRoot, "landings", "es-only-landing");
    fs.mkdirSync(landingDir, { recursive: true });
    fs.writeFileSync(
      path.join(landingDir, "_common.yml"),
      "slug: es-only-landing\nprograms:\n  - ai-engineering\n",
    );
    fs.writeFileSync(
      path.join(landingDir, "es.yml"),
      [
        "slug: es-only-landing",
        "title: Programa ES",
        "description: Descripción del programa.",
        "meta:",
        "  page_title: Título SEO ES",
        "  description: Meta descripción ES.",
      ].join("\n") + "\n",
    );
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("gates against live locale files, not only default en", () => {
    expect(getCommonEditGateLocales("landings", "es-only-landing", contentRoot)).toEqual([
      "es",
    ]);

    const ci = new ContentIndex(contentRoot);
    const failure = evaluateCommonContentLiveGate({
      contentType: "landings",
      slug: "es-only-landing",
      commonData: {
        slug: "es-only-landing",
        programs: ["ai-engineering"],
        locations: ["mexicocity-mexico"],
      },
      ci,
      contentRootName: contentRoot,
      touchedPaths: ["locations"],
    });

    expect(failure).toBeNull();
  });

  it("fails when a live locale is missing required meta after common merge", () => {
    const landingDir = path.join(contentRoot, "landings", "es-only-landing");
    fs.writeFileSync(
      path.join(landingDir, "es.yml"),
      "slug: es-only-landing\ntitle: ''\ndescription: ''\nmeta:\n  page_title: ''\n  description: ''\n",
    );

    const ci = new ContentIndex(contentRoot);
    const failure = evaluateCommonContentLiveGate({
      contentType: "landings",
      slug: "es-only-landing",
      commonData: { slug: "es-only-landing", locations: ["mexicocity-mexico"] },
      ci,
      contentRootName: contentRoot,
      intent: "publish",
    });

    expect(failure).not.toBeNull();
    expect(failure?.message).toContain("meta.page_title");
  });
});

describe("liveSeoGateIntentFromOperations", () => {
  it("uses publish for replace_all_sections", () => {
    expect(
      liveSeoGateIntentFromOperations([{ action: "replace_all_sections" }]),
    ).toBe("publish");
  });

  it("uses micro for add_item and leaves touchedPaths empty", () => {
    const ops = [{ action: "add_item", path: "sections" }];
    expect(liveSeoGateIntentFromOperations(ops)).toBe("micro");
    expect(touchedPathsFromOperations(ops)).toEqual([]);
  });
});
