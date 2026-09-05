import { beforeEach, describe, expect, it, vi } from "vitest";

const getAllConfigs = vi.fn();
const validateFieldMapping = vi.fn();

vi.mock("../../../server/content-types", () => ({
  getAllConfigs: (...args: unknown[]) => getAllConfigs(...args),
}));

vi.mock("../shared/fieldMappingValidator", () => ({
  validateFieldMapping: (...args: unknown[]) => validateFieldMapping(...args),
}));

import { fieldMappingsValidator } from "./field-mappings";

describe("fieldMappingsValidator", () => {
  beforeEach(() => {
    getAllConfigs.mockReset();
    validateFieldMapping.mockReset();
  });

  it("does not raise error or warning when an optional mapped field is missing", async () => {
    getAllConfigs.mockReturnValue({
      scholarship: {
        field_mapping: {
          partner_name: { source: "partner_name", default: null },
          application_closes: { source: "application_closes", default: null },
        },
        editor: {
          partner_name: { required: true },
          application_closes: { required: false },
        },
      },
    });
    validateFieldMapping.mockReturnValue({
      allValid: false,
      results: {
        partner_name: {
          valid: true,
          total: 2,
          found: 2,
          missing: [],
        },
        application_closes: {
          valid: true,
          total: 2,
          found: 0,
          missing: [],
          isNewField: true,
        },
      },
    });

    const result = await fieldMappingsValidator.run({
      contentFiles: [],
      redirectMap: new Map(),
      availableSchemas: new Set(),
      sitemapEntries: [],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.status).toBe("passed");
  });

  it("still errors when a required mapped field is missing from all entries", async () => {
    getAllConfigs.mockReturnValue({
      scholarship: {
        field_mapping: {
          partner_name: { source: "partner_name", default: null },
        },
        editor: {
          partner_name: { required: true },
        },
      },
    });
    validateFieldMapping.mockReturnValue({
      allValid: false,
      results: {
        partner_name: {
          valid: false,
          total: 2,
          found: 0,
          missing: [{ slug: "a", files: ["a.yml"] }],
        },
      },
    });

    const result = await fieldMappingsValidator.run({
      contentFiles: [],
      redirectMap: new Map(),
      availableSchemas: new Set(),
      sitemapEntries: [],
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.code).toBe("FIELD_MAPPING_MISSING");
    expect(result.status).toBe("failed");
  });

  it("does not warn for partial presence on optional fields", async () => {
    getAllConfigs.mockReturnValue({
      scholarship: {
        field_mapping: {
          application_closes: "application_closes",
        },
        editor: {
          application_closes: { required: false },
        },
      },
    });
    validateFieldMapping.mockReturnValue({
      allValid: false,
      results: {
        application_closes: {
          valid: false,
          total: 2,
          found: 1,
          missing: [{ slug: "b", files: ["b.yml"] }],
        },
      },
    });

    const result = await fieldMappingsValidator.run({
      contentFiles: [],
      redirectMap: new Map(),
      availableSchemas: new Set(),
      sitemapEntries: [],
    });

    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.status).toBe("passed");
  });
});
