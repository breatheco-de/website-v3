import { beforeEach, describe, expect, it, vi } from "vitest";

const scanProductContent = vi.hoisted(() => vi.fn());
const listProductRows = vi.hoisted(() => vi.fn());
const readEntryProduct = vi.hoisted(() => vi.fn());

vi.mock("../product/product-index", () => ({
  scanProductContent,
}));

vi.mock("../product/product-io", () => ({
  listProductRows,
  readEntryProduct,
}));

vi.mock("../content-index", () => ({
  contentIndex: {},
}));

vi.mock("../schema-org", () => ({
  loadResolvedSchemaConfig: () => ({}),
}));

vi.mock("../variable-manager", () => ({
  getVariableManager: () => ({ getDefinitions: () => ({}), resolveString: () => ({ text: "" }) }),
}));

import { buildProductsInput } from "./regenerate-prompt";

describe("buildProductsInput", () => {
  beforeEach(() => {
    scanProductContent.mockReset();
    listProductRows.mockReset();
    readEntryProduct.mockReset();
    listProductRows.mockReturnValue([]);
    readEntryProduct.mockReturnValue(null);
  });

  it("scans product content before listing rows", () => {
    listProductRows.mockReturnValue([
      {
        product_id: "p1",
        name: "AI Engineering",
        content_type: "program",
        content_slug: "ai-engineering",
        actively_selling: true,
        purchasable: true,
        audience_status: "minimal",
        urls: { en: "/en/career-programs/ai-engineering", es: "/es/programas-de-carrera/ingenieria-ia" },
        personas: [],
      },
    ]);
    readEntryProduct.mockReturnValue({
      description: "Learn AI",
      offer: { one_liner: "Become an AI engineer", who_its_for: "Career changers" },
      personas: [],
    });

    const json = buildProductsInput("site_4geeks-com");
    expect(scanProductContent).toHaveBeenCalledWith("site_4geeks-com");
    expect(listProductRows).toHaveBeenCalled();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].content_slug).toBe("ai-engineering");
    expect(parsed[0].urls.en).toContain("/en/career-programs/ai-engineering");
  });
});
