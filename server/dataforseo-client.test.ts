import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./settings", () => ({
  getDataForSeoSettings: vi.fn(() => ({
    enabled: true,
    daily_usd_limit: 2,
    session_usd_limit: 0.5,
    budget_warn_percent: 80,
  })),
}));

import {
  classifyDataForSeoStatus,
  dataForSeoMode,
  estimateKeywordOverviewUsd,
  fetchDataForSeoBalance,
  keywordOverviewQuery,
  parseDataForSeoEnvelope,
  parseKeywordOverviewItem,
} from "./dataforseo-client";
import { setLiveServerForTests } from "./live-server";

const okEnvelope = (result: unknown[], cost = 0.0101) => ({
  status_code: 20000,
  status_message: "Ok.",
  cost,
  tasks: [{ status_code: 20000, status_message: "Ok.", cost, result }],
});

describe("parseDataForSeoEnvelope", () => {
  it("returns task result and cost on success", () => {
    const r = parseDataForSeoEnvelope(okEnvelope([{ items: [] }], 0.0102), 200);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.cost_usd).toBe(0.0102);
      expect(r.result).toHaveLength(1);
    }
  });

  it("treats a task-level error inside HTTP 200 as a failure", () => {
    const r = parseDataForSeoEnvelope(
      {
        status_code: 20000,
        tasks: [{ status_code: 40210, status_message: "insufficient funds." }],
      },
      200,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error_kind).toBe("funds");
      expect(r.fatal).toBe(true);
      expect(r.error).toMatch(/Top up/);
    }
  });

  it("maps top-level auth errors to fatal auth", () => {
    const r = parseDataForSeoEnvelope({ status_code: 40100, status_message: "not authorized" }, 401);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error_kind).toBe("auth");
      expect(r.fatal).toBe(true);
    }
  });

  it("treats 'no search results' as an empty success", () => {
    const r = parseDataForSeoEnvelope(
      { status_code: 20000, tasks: [{ status_code: 40102, cost: 0.01 }] },
      200,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.result).toEqual([]);
  });

  it("marks bad-request codes as non-fatal", () => {
    const r = parseDataForSeoEnvelope(
      { status_code: 20000, tasks: [{ status_code: 40501, status_message: "invalid field." }] },
      200,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error_kind).toBe("request");
      expect(r.fatal).toBe(false);
    }
  });

  it("maps unreadable 5xx bodies to unavailable", () => {
    const r = parseDataForSeoEnvelope(null, 503);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error_kind).toBe("unavailable");
  });
});

describe("classifyDataForSeoStatus", () => {
  it("groups codes by staff outcome", () => {
    expect(classifyDataForSeoStatus(40104)).toBe("auth");
    expect(classifyDataForSeoStatus(40200)).toBe("funds");
    expect(classifyDataForSeoStatus(40203)).toBe("funds");
    expect(classifyDataForSeoStatus(50301)).toBe("unavailable");
    expect(classifyDataForSeoStatus(40209)).toBe("unavailable");
    expect(classifyDataForSeoStatus(40503)).toBe("request");
  });
});

describe("parseKeywordOverviewItem", () => {
  it("reads volume, real difficulty and intent", () => {
    const m = parseKeywordOverviewItem({
      keyword: "tipos de inteligencia artificial",
      keyword_info: { search_volume: 2900, competition_level: "LOW" },
      keyword_properties: { keyword_difficulty: 18 },
      search_intent_info: { main_intent: "informational" },
    });
    expect(m).toMatchObject({
      keyword: "tipos de inteligencia artificial",
      monthly_volume: 2900,
      kw_difficulty: 18,
      kw_difficulty_source: "reported",
      competition_level: "LOW",
      intent: "informational",
    });
  });

  it("leaves difficulty unknown instead of using ad competition", () => {
    const m = parseKeywordOverviewItem({
      keyword: "niche term",
      keyword_info: { search_volume: 40, competition_level: "LOW" },
      keyword_properties: { keyword_difficulty: null },
    });
    expect(m?.kw_difficulty).toBeNull();
    expect(m?.kw_difficulty_source).toBeNull();
    expect(m?.monthly_volume).toBe(40);
  });
});

describe("estimateKeywordOverviewUsd", () => {
  it("charges one task per 700 keywords plus per keyword", () => {
    expect(estimateKeywordOverviewUsd(0)).toBe(0);
    expect(estimateKeywordOverviewUsd(1)).toBe(0.0101);
    expect(estimateKeywordOverviewUsd(701)).toBe(0.0901);
  });
});

describe("dataForSeoMode", () => {
  const prev = process.env.DATAFORSEO_USE_LIVE;
  afterEach(() => {
    setLiveServerForTests(null);
    if (prev === undefined) delete process.env.DATAFORSEO_USE_LIVE;
    else process.env.DATAFORSEO_USE_LIVE = prev;
  });

  it("uses sandbox off the live server", () => {
    delete process.env.DATAFORSEO_USE_LIVE;
    setLiveServerForTests(false);
    expect(dataForSeoMode()).toBe("sandbox");
  });

  it("uses live on the live server", () => {
    delete process.env.DATAFORSEO_USE_LIVE;
    setLiveServerForTests(true);
    expect(dataForSeoMode()).toBe("live");
  });

  it("honors DATAFORSEO_USE_LIVE=true locally", () => {
    process.env.DATAFORSEO_USE_LIVE = "true";
    setLiveServerForTests(false);
    expect(dataForSeoMode()).toBe("live");
  });
});

describe("keywordOverviewQuery / fetchDataForSeoBalance", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.DATAFORSEO_LOGIN = "login";
    process.env.DATAFORSEO_PASSWORD = "secret";
    delete process.env.DATAFORSEO_USE_LIVE;
    setLiveServerForTests(false);
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setLiveServerForTests(null);
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
  });

  it("posts market names to the sandbox and keys metrics by lowercase keyword", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () =>
        okEnvelope([
          {
            items: [
              {
                keyword: "what is prompt engineering",
                keyword_info: { search_volume: 2900 },
                keyword_properties: { keyword_difficulty: 27 },
              },
            ],
          },
        ]),
    });
    const r = await keywordOverviewQuery({
      keywords: ["What is prompt engineering"],
      market: { location: "United States", language: "English" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("sandbox.dataforseo.com/v3/dataforseo_labs/google/keyword_overview/live");
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from("login:secret").toString("base64")}`);
    expect(JSON.parse(init.body)).toEqual([
      { keywords: ["What is prompt engineering"], location_name: "United States", language_name: "English" },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mode).toBe("sandbox");
      expect(r.metrics.get("what is prompt engineering")?.kw_difficulty).toBe(27);
    }
  });

  it("fails fatally without credentials and does not call the API", async () => {
    delete process.env.DATAFORSEO_PASSWORD;
    const r = await keywordOverviewQuery({
      keywords: ["x"],
      market: { location: "Spain", language: "Spanish" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fatal).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps network errors to unavailable", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNRESET"));
    const r = await keywordOverviewQuery({
      keywords: ["x"],
      market: { location: "Spain", language: "Spanish" },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error_kind).toBe("unavailable");
      expect(r.fatal).toBe(true);
    }
  });

  it("reads money.balance from user_data", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      json: async () => okEnvelope([{ money: { total: 50, balance: 42.123456 } }], 0),
    });
    const r = await fetchDataForSeoBalance();
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.balance_usd).toBe(42.1235);
  });
});
