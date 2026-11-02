import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

vi.mock("../lib/content.js", () => ({
  resolveSiteContext: () => ({ ok: true, contentPath: "/tmp/site_x", contentFolder: "site_x" }),
  resolveContentType: () => ({ contentType: "blog" }),
}));
vi.mock("../lib/auth.js", () => ({
  checkCap: vi.fn(async () => true),
  denyResponse: (cap: string) => ({ content: [{ type: "text", text: JSON.stringify({ success: false, code: "denied", cap }) }] }),
  denyUnlessContentViewOrSeo: vi.fn(async () => null),
}));
vi.mock("../lib/seo-cluster-inventory.js", () => ({
  buildGetSeoCluster: vi.fn(),
  buildListSeoClusterEntries: vi.fn(),
  buildListSeoClusters: vi.fn(),
  isClusterFilterBucket: () => false,
}));
vi.mock("../lib/seo-research-mcp.js", () => ({ runSeoResearch: vi.fn() }));

const { registerSeoClusterTools } = await import("./seo-clusters");
const { runSeoResearch } = await import("../lib/seo-research-mcp.js");
const mockedRun = vi.mocked(runSeoResearch);

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

function researchHandler(): Handler {
  const handlers = new Map<string, Handler>();
  const mcp = {
    tool: (...args: unknown[]) => handlers.set(args[0] as string, args[args.length - 1] as Handler),
  } as unknown as McpServer;
  registerSeoClusterTools(mcp, "token");
  return handlers.get("get_or_refresh_seo_research")!;
}

const parse = (r: Awaited<ReturnType<Handler>>) => JSON.parse(r.content[0]!.text) as Record<string, unknown>;

const WHY = "Check search volume and difficulty for the main keyword before refreshing this article.";

describe("get_or_refresh_seo_research handler", () => {
  beforeEach(() => {
    mockedRun.mockReset();
    mockedRun.mockResolvedValue({
      ok: true,
      action: "keyword_metrics",
      outcome: "cache_hit",
      credits_spent: 0,
      budget: {},
      data: { keyword: "tipos de inteligencia artificial", kw_difficulty: 20, kw_difficulty_source: "derived_from_competition" },
      warnings: [],
      side_effects: [],
      next_actions: [],
    });
  });

  it("runs with why only — no highlights needed for a research read", async () => {
    const out = parse(
      await researchHandler()({
        action: "keyword_metrics",
        contentType: "blog",
        slug: "tipos-de-inteligencia-artificial",
        locale: "es",
        why: WHY,
        agent_session_id: "s1",
      }),
    );
    expect(out.success).toBe(true);
    expect(out.outcome).toBe("cache_hit");
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("runs planning actions with why only", async () => {
    mockedRun.mockResolvedValue({
      ok: true,
      action: "keyword_ideas",
      outcome: "fetched",
      credits_spent: 3,
      budget: {},
      data: {},
      warnings: [],
      side_effects: [],
      next_actions: [],
    });
    const out = parse(
      await researchHandler()({ action: "keyword_ideas", seed: "inteligencia artificial", locale: "es", why: WHY, agent_session_id: "s1" }),
    );
    expect(out.success).toBe(true);
    expect(mockedRun).toHaveBeenCalledTimes(1);
  });

  it("still rejects a missing or short why without calling research", async () => {
    const handler = researchHandler();
    const missing = parse(await handler({ action: "keyword_metrics", contentType: "blog", slug: "a", agent_session_id: "s1" }));
    expect(missing.code).toBe("report_required");
    const short = parse(
      await handler({ action: "keyword_metrics", contentType: "blog", slug: "a", why: "check kw", agent_session_id: "s1" }),
    );
    expect(short.code).toBe("report_too_short");
    expect(mockedRun).not.toHaveBeenCalled();
  });
});
