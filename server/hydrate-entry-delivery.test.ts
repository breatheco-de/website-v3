import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./resolve-relations", () => ({
  resolveRelationsOnEntry: vi.fn(async (_ct: string, entry: Record<string, unknown>) => ({
    ...entry,
    _relations: true,
  })),
}));

vi.mock("./live-request", () => ({
  resolveLiveRequestsOnEntry: vi.fn(async (_ct: string, entry: Record<string, unknown>) => ({
    ...entry,
    _live: true,
  })),
}));

import { resolveRelationsOnEntry } from "./resolve-relations";
import { resolveLiveRequestsOnEntry } from "./live-request";
import { hydrateEntryForDelivery } from "./hydrate-entry-delivery";

afterEach(() => {
  vi.clearAllMocks();
});

describe("hydrateEntryForDelivery", () => {
  it("runs relations then live_request", async () => {
    const result = await hydrateEntryForDelivery("workshop", { id: 1, slug: "x" }, {
      contentRoot: "site_4geeks-com",
      locale: "en",
    });

    expect(resolveRelationsOnEntry).toHaveBeenCalledWith(
      "workshop",
      { id: 1, slug: "x" },
      expect.objectContaining({ contentRoot: "site_4geeks-com", locale: "en" }),
    );
    expect(resolveLiveRequestsOnEntry).toHaveBeenCalledWith(
      "workshop",
      expect.objectContaining({ id: 1, _relations: true }),
      { contentRoot: "site_4geeks-com" },
    );
    expect(result).toEqual(
      expect.objectContaining({ id: 1, _relations: true, _live: true }),
    );
  });
});
