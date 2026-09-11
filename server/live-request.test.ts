import { describe, expect, it, vi, afterEach } from "vitest";
import { isPrivateDestination } from "@shared/ssrf";

vi.mock("./content-types", () => ({
  getContentTypeConfig: vi.fn(),
  getFieldMapping: vi.fn(() => ({})),
  getFullFieldMapping: vi.fn(() => null),
}));

vi.mock("./transform", async () => {
  const actual = await vi.importActual<typeof import("./transform")>("./transform");
  return {
    ...actual,
    resolveFieldValue: vi.fn((_src: string, item: Record<string, unknown>) => {
      const list = item.seats_checkins;
      return Array.isArray(list) ? list.length : null;
    }),
  };
});

import { getContentTypeConfig, getFullFieldMapping } from "./content-types";
import {
  reapplyContentTypeFunctions,
  resolveLiveRequestsOnEntry,
} from "./live-request";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("isPrivateDestination (SSRF guard for live_request)", () => {
  it("blocks localhost", () => {
    expect(isPrivateDestination("http://127.0.0.1/x")).toBe(true);
    expect(isPrivateDestination("http://localhost/x")).toBe(true);
  });

  it("allows public https", () => {
    expect(
      isPrivateDestination(
        "https://breathecode.herokuapp.com/v1/events/event/1/checkin",
      ),
    ).toBe(false);
  });
});

describe("resolveLiveRequestsOnEntry", () => {
  it("fetches and sets field from array root", async () => {
    vi.mocked(getContentTypeConfig).mockReturnValue({
      editor: {
        seats_checkins: {
          type: "live_request",
          request: {
            url: "https://example.com/v1/events/event/{{ entry.id }}/checkin",
          },
          response: { items_path: "$" },
        },
      },
    } as never);
    vi.mocked(getFullFieldMapping).mockReturnValue({
      registered_count: "function:dummy",
    } as never);

    const payload = [{ id: 1 }, { id: 2 }];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/event/99/checkin");
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(JSON.stringify(payload)),
        };
      }),
    );

    const result = await resolveLiveRequestsOnEntry("workshop", {
      id: 99,
      slug: "demo",
      capacity: 10,
    });

    expect(result?.seats_checkins).toEqual(payload);
    expect(result?.registered_count).toBe(2);
  });

  it("resolves {{ entry.* }} and pipe fallback via resolveSingleVars", async () => {
    vi.mocked(getContentTypeConfig).mockReturnValue({
      editor: {
        seats_checkins: {
          type: "live_request",
          request: {
            url: "https://example.com/v1/events/event/{{ entry.id | 0 }}/checkin",
          },
          response: { items_path: "$" },
        },
      },
    } as never);
    vi.mocked(getFullFieldMapping).mockReturnValue({} as never);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        expect(url).toContain("/event/42/checkin");
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from("[]"),
        };
      }),
    );

    await resolveLiveRequestsOnEntry("workshop", { id: 42, slug: "demo" });
  });

  it("leaves field empty on private URL", async () => {
    vi.mocked(getContentTypeConfig).mockReturnValue({
      editor: {
        seats_checkins: {
          type: "live_request",
          request: { url: "http://127.0.0.1/secret" },
        },
      },
    } as never);
    vi.mocked(getFullFieldMapping).mockReturnValue({} as never);

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await resolveLiveRequestsOnEntry("workshop", { id: 1 });
    expect(result?.seats_checkins).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("reapplyContentTypeFunctions", () => {
  it("applies function mappings", () => {
    vi.mocked(getFullFieldMapping).mockReturnValue({
      registered_count: "function:dummy",
    } as never);
    const out = reapplyContentTypeFunctions("workshop", {
      seats_checkins: [1, 2, 3],
    });
    expect(out.registered_count).toBe(3);
  });
});
