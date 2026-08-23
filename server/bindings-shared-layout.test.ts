import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./content-types", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./content-types")>();
  return {
    ...actual,
    getContentTypeConfig: vi.fn((type: string) => {
      if (type === "how-to" || type === "blog") {
        return { database: { slug: "how_to" }, single_template: false };
      }
      if (type === "shared-static") {
        return { single_template: true };
      }
      return { directory: type };
    }),
  };
});

vi.mock("./content-index", () => ({
  contentIndex: {
    loadLocaleData: () => ({ data: null, filePath: "" }),
  },
}));

vi.mock("./sync-state", () => ({
  markFileAsModified: vi.fn(),
}));

vi.mock("./site-config", () => ({
  getDefaultContentFolder: () => "site_4geeks-com",
  getDefaultContentRoot: () => "site_4geeks-com",
}));

import { isSharedLayoutContentType } from "./bindings";

describe("bindings vs shared layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("treats DB-backed and single_template types as shared layout", () => {
    expect(isSharedLayoutContentType("how-to")).toBe(true);
    expect(isSharedLayoutContentType("blog")).toBe(true);
    expect(isSharedLayoutContentType("shared-static")).toBe(true);
    expect(isSharedLayoutContentType("location")).toBe(false);
  });
});
