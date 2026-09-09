import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("./ai/LLMService", () => ({
  DEFAULT_COMPLETION_MODEL: "openai/gpt-4o-mini",
  getLLMService: vi.fn(),
}));

import { getLLMService } from "./ai/LLMService";
import { gateAgentReport } from "./agent-report-gate";

describe("gateAgentReport", () => {
  const prevEnv = process.env.AGENT_REPORT_AI_GATE;

  beforeEach(() => {
    vi.mocked(getLLMService).mockReset();
    delete process.env.AGENT_REPORT_AI_GATE;
  });

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.AGENT_REPORT_AI_GATE;
    else process.env.AGENT_REPORT_AI_GATE = prevEnv;
  });

  it("fails closed on missing why", async () => {
    const r = await gateAgentReport({
      why: "",
      highlights: ["Set pillar path"],
      mode: "complete",
      skipAi: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("report_required");
  });

  it("accepts simple mutate with skipAi", async () => {
    const r = await gateAgentReport({
      why: "Set SEO pillar path so orphan joins Coding Bootcamp hub (#419).",
      highlights: [],
      mode: "mutate_with_updates",
      updates: [{ field_path: "seo.pillar_path", value: "/us/coding-bootcamp" }],
      skipAi: true,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.simple_changes).toEqual([
        { field: "seo.pillar_path", after: "/us/coding-bootcamp" },
      ]);
      expect(r.report).toContain("Why:");
    }
  });

  it("rejects big mutate without highlights", async () => {
    const r = await gateAgentReport({
      why: "Refresh article body and add internal links for cluster coverage.",
      highlights: [],
      mode: "mutate_with_updates",
      updates: [{ field_path: "sections.0.data", value: { html: "<p>x</p>" } }],
      skipAi: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("report_quality");
  });

  it("fail-open when AI times out on unsure", async () => {
    vi.mocked(getLLMService).mockReturnValue({
      adaptContentStructured: () =>
        new Promise(() => {
          /* never resolves */
        }),
    } as ReturnType<typeof getLLMService>);

    const r = await gateAgentReport({
      why: "Cambio automatico del bot SEO de 4Geeks via MCP update_fields for orphan refresh ticket number four one nine cluster join.",
      highlights: ["Joined hub"],
      mode: "mutate_with_updates",
      updates: [{ field_path: "seo.pillar_path", value: "/hub" }],
    });
    expect(r.ok).toBe(true);
  });

  it("AI reject when judge returns ok false", async () => {
    vi.mocked(getLLMService).mockReturnValue({
      adaptContentStructured: async () => ({
        content: { ok: false, missing: ["Name the hub you joined."] },
      }),
    } as ReturnType<typeof getLLMService>);

    const r = await gateAgentReport({
      why: "Cambio automatico del bot SEO de 4Geeks via MCP update_fields for orphan refresh ticket number four one nine cluster join.",
      highlights: ["Joined hub"],
      mode: "mutate_with_updates",
      updates: [{ field_path: "seo.pillar_path", value: "/hub" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe("report_quality");
      expect(r.missing[0]).toMatch(/hub/i);
    }
  });
});
