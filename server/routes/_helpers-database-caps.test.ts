/**
 * Unit tests for database capability scope resolution used by /api/databases.
 *
 * Full Express route denial tests are not practical here (dev bypass + session plumbing).
 * Item mutate routes call requireCapability("databases_edit_data", req.params.name);
 * browse GETs call requireDatabasesBrowseAccess (manage OR grantAllowsAnyDatabasesEditDataAccess).
 * Scope fail-closed / include / * are covered in user-store-content-view.test.ts (grantAllowsCap).
 */
import { describe, expect, it } from "vitest";
import type { Request } from "express";
import { resolveCapabilityScope } from "./_helpers";

function mockReq(partial: {
  params?: Record<string, string>;
  body?: Record<string, unknown>;
}): Request {
  return {
    params: partial.params ?? {},
    body: partial.body ?? {},
  } as Request;
}

describe("resolveCapabilityScope", () => {
  it("for databases_edit_data uses params.name (item mutate routes)", () => {
    const req = mockReq({ params: { name: "testimonials" } });
    expect(resolveCapabilityScope(req, "databases_edit_data")).toBe("testimonials");
  });

  it("for databases_edit_data falls back to body.database / body.name", () => {
    expect(
      resolveCapabilityScope(mockReq({ body: { database: "faq" } }), "databases_edit_data"),
    ).toBe("faq");
    expect(
      resolveCapabilityScope(mockReq({ body: { name: "programs" } }), "databases_edit_data"),
    ).toBe("programs");
  });

  it("explicit scope wins over request params", () => {
    const req = mockReq({ params: { name: "faq" } });
    expect(resolveCapabilityScope(req, "databases_edit_data", "testimonials")).toBe("testimonials");
  });

  it("returns undefined for unscoped databases_manage (no slug required)", () => {
    const req = mockReq({ params: { name: "faq" } });
    expect(resolveCapabilityScope(req, "databases_manage")).toBeUndefined();
  });

  it("for content_types caps still uses contentType / type", () => {
    expect(
      resolveCapabilityScope(
        mockReq({ params: { contentType: "blog" } }),
        "content_edit_text",
      ),
    ).toBe("blog");
    expect(
      resolveCapabilityScope(mockReq({ body: { type: "landing" } }), "content_view"),
    ).toBe("landing");
  });
});
