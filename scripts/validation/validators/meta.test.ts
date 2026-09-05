import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { metaValidator } from "./meta";
import type { ContentFile, ValidationContext } from "../shared/types";
import { resetVariableManagerCache } from "../../../server/variable-manager";
import * as resolveTemplateVars from "../../../server/resolve-template-vars";

function makeContext(
  files: ContentFile[],
  contentRoot?: string,
): ValidationContext {
  return {
    contentFiles: files,
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
    contentRoot,
  };
}

function makeFile(
  partial: Partial<ContentFile> & {
    meta?: ContentFile["meta"];
    entryFields?: Record<string, unknown>;
  },
): ContentFile {
  return {
    slug: partial.slug || "page",
    title: partial.title ?? "Page",
    type: partial.type || "landing",
    locale: partial.locale || "en",
    filePath: partial.filePath || "landing/page/en.yml",
    meta: partial.meta,
    entryFields: partial.entryFields,
    ...partial,
  };
}

describe("metaValidator site-var resolve", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-validator-"));
    fs.writeFileSync(
      path.join(tmpRoot, "variables.yml"),
      [
        "brand.title:",
        '  default: "Acme Corp"',
        "global.greeting:",
        '  default: "Hello from global"',
        "global.blank_one:",
        '  default: ""',
      ].join("\n"),
      "utf-8",
    );
    resetVariableManagerCache();
  });

  afterEach(() => {
    resetVariableManagerCache();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("passes when page_title and description use defined global.* vars", async () => {
    const result = await metaValidator.run(
      makeContext(
        [
          makeFile({
            meta: {
              page_title: "{{ global.greeting }}",
              description: "About {{ global.greeting }}",
            },
          }),
        ],
        tmpRoot,
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.status).toBe("passed");
  });

  it("passes when page_title and description use defined brand.* vars", async () => {
    const result = await metaValidator.run(
      makeContext(
        [
          makeFile({
            meta: {
              page_title: "{{ brand.title }} | Home",
              description: "Welcome to {{ brand.title }}",
            },
          }),
        ],
        tmpRoot,
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.status).toBe("passed");
  });

  it("passes when a blank global has a pipe fallback", async () => {
    const result = await metaValidator.run(
      makeContext(
        [
          makeFile({
            meta: {
              page_title: "{{ global.blank_one | Fallback Title }}",
              description: "{{ global.blank_one | Fallback description for SEO }}",
            },
          }),
        ],
        tmpRoot,
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.status).toBe("passed");
  });

  it("does not emit META_USES_GLOBAL_VAR for resolved globals", async () => {
    const result = await metaValidator.run(
      makeContext(
        [
          makeFile({
            meta: {
              page_title: "{{ global.greeting }}",
              description: "{{ global.greeting }} site copy",
            },
          }),
        ],
        tmpRoot,
      ),
    );
    expect(result.warnings.some((w) => w.code === "META_USES_GLOBAL_VAR")).toBe(false);
    expect(result.errors.some((e) => e.code === "META_USES_GLOBAL_VAR")).toBe(false);
  });

  it("emits MISSING_PAGE_TITLE / MISSING_DESCRIPTION for empty literals", async () => {
    const result = await metaValidator.run(
      makeContext(
        [
          makeFile({
            meta: {
              page_title: "   ",
              description: "",
            },
          }),
        ],
        tmpRoot,
      ),
    );
    expect(result.errors.map((e) => e.code).sort()).toEqual([
      "MISSING_DESCRIPTION",
      "MISSING_PAGE_TITLE",
    ]);
    expect(result.warnings).toEqual([]);
  });

  it("emits MISSING when {{ single.title }} resolves to empty", async () => {
    const result = await metaValidator.run(
      makeContext(
        [
          makeFile({
            title: "",
            entryFields: { title: "" },
            meta: {
              page_title: "{{ single.title }}",
              description: "A solid meta description for the page",
            },
          }),
        ],
        tmpRoot,
      ),
    );
    expect(result.errors.some((e) => e.code === "MISSING_PAGE_TITLE")).toBe(true);
    expect(result.errors.some((e) => e.code === "UNRESOLVED_META_TEMPLATE")).toBe(false);
    expect(result.warnings.some((w) => w.code === "META_USES_GLOBAL_VAR")).toBe(false);
  });

  it("emits UNRESOLVED_META_TEMPLATE when templates remain after resolve", async () => {
    vi.spyOn(resolveTemplateVars, "resolveAllTemplateVars").mockReturnValue({
      page_title: "{{ still.unresolved }}",
      description: "A valid description that is long enough",
    });

    const result = await metaValidator.run(
      makeContext(
        [
          makeFile({
            meta: {
              page_title: "{{ still.unresolved }}",
              description: "A valid description that is long enough",
            },
          }),
        ],
        tmpRoot,
      ),
    );

    expect(result.errors.some((e) => e.code === "UNRESOLVED_META_TEMPLATE")).toBe(true);
    expect(result.errors.some((e) => e.code === "MISSING_PAGE_TITLE")).toBe(false);
    expect(result.errors.some((e) => e.code === "META_USES_GLOBAL_VAR")).toBe(false);
    expect(result.warnings.some((w) => w.code === "META_USES_GLOBAL_VAR")).toBe(false);
  });

  it("skips variant files", async () => {
    const result = await metaValidator.run(
      makeContext(
        [
          makeFile({
            variant: "exp-a",
            meta: {
              page_title: "",
              description: "",
            },
          }),
        ],
        tmpRoot,
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.status).toBe("passed");
  });
});
