import { describe, expect, it } from "vitest";
import { TOOL_GATES } from "../../shared/mcp-tool-catalog.js";
import {
  buildProposalDiscoveryPath,
  proposalDiscoveryToolNames,
} from "./proposal-discovery-path.js";
import { assertCatalogToolNames } from "./respond.js";

const catalog = new Set(Object.keys(TOOL_GATES));

const baseEdits = {
  id: "p1",
  status: "open",
  kind: "edits",
  title: "Fix CTA",
  summary: "Update the primary CTA copy on the landing page to match the offer.",
  open_blocker_count: 0,
  entries: [
    { contentType: "landing", slug: "ai-course", locale: "en", status: "pending" },
    { contentType: "landing", slug: "ai-course", locale: "es", status: "pending" },
  ],
};

describe("buildProposalDiscoveryPath", () => {
  it("returns null for finished/rejected/withdrawn", () => {
    for (const status of ["finished", "rejected", "withdrawn"] as const) {
      const { discovery_path } = buildProposalDiscoveryPath({
        proposal: { ...baseEdits, status },
        allowedTools: catalog,
      });
      expect(discovery_path).toBeNull();
    }
  });

  it("builds edits path with think-before-tools and ≤5 thinks", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: baseEdits,
      allowedTools: catalog,
      strategy: { purpose: "Landing pages that convert warm traffic.", constraints: ["No fake scarcity"] },
    });
    expect(discovery_path).not.toBeNull();
    const items = discovery_path!.items;
    const thinks = items.filter((i) => i.kind === "think");
    const tools = items.filter((i) => i.kind === "tool");
    expect(thinks.length).toBeGreaterThan(0);
    expect(thinks.length).toBeLessThanOrEqual(5);
    expect(tools.length).toBe(proposalDiscoveryToolNames().length);
    const firstToolIdx = items.findIndex((i) => i.kind === "tool");
    const lastThinkIdx = items.map((i) => i.kind).lastIndexOf("think");
    expect(lastThinkIdx).toBeLessThan(firstToolIdx);
    expect(tools.every((t) => t.kind === "tool" && t.available)).toBe(true);
    expect(warnings).toEqual([]);

    const strategy = thinks.find((t) => t.id === "strategy_fit");
    expect(strategy?.kind).toBe("think");
    if (strategy?.kind === "think") {
      expect(strategy.look_for.some((l) => l.includes("Landing pages"))).toBe(true);
    }

    const toolNames = tools.map((t) => (t.kind === "tool" ? t.tool : "")).filter(Boolean);
    expect(assertCatalogToolNames(toolNames, catalog)).toEqual({ ok: true });
  });

  it("marks tools unavailable and warns when grants are thin", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: baseEdits,
      allowedTools: new Set(["get_entry_content", "get_entry_activity"]),
    });
    expect(discovery_path).not.toBeNull();
    const tools = discovery_path!.items.filter((i) => i.kind === "tool");
    const capped = tools.filter((t) => t.kind === "tool" && !t.available);
    expect(capped.length).toBeGreaterThan(0);
    expect(capped.every((t) => t.kind === "tool" && t.hint)).toBe(true);
    expect(warnings.some((w) => w.code === "discovery_tool_capped")).toBe(true);
    // think items still present
    expect(discovery_path!.items.some((i) => i.kind === "think")).toBe(true);
  });

  it("uses generic strategy copy when strategy missing", () => {
    const { discovery_path } = buildProposalDiscoveryPath({
      proposal: baseEdits,
      allowedTools: catalog,
      strategy: null,
    });
    const strategy = discovery_path!.items.find((i) => i.kind === "think" && i.id === "strategy_fit");
    expect(strategy?.kind).toBe("think");
    if (strategy?.kind === "think") {
      expect(strategy.look_for.some((l) => /do not invent a strategy/i.test(l))).toBe(true);
    }
  });

  it("builds short notes path without apply-research tools", () => {
    const { discovery_path, warnings } = buildProposalDiscoveryPath({
      proposal: {
        id: "n1",
        status: "partial",
        kind: "notes",
        summary: "Tried X and Y; need human decision on Z.",
      },
      allowedTools: new Set(),
    });
    expect(discovery_path).not.toBeNull();
    expect(discovery_path!.items.every((i) => i.kind === "think")).toBe(true);
    expect(discovery_path!.items.length).toBeLessThanOrEqual(5);
    expect(warnings).toEqual([]);
    expect(discovery_path!.goal.toLowerCase()).toMatch(/close/);
  });

  it("edits discovery tools are all catalog members", () => {
    expect(assertCatalogToolNames(proposalDiscoveryToolNames(), catalog)).toEqual({ ok: true });
  });
});

describe("assertCatalogToolNames", () => {
  it("flags unknown tools", () => {
    expect(assertCatalogToolNames(["get_entry_content", "validate_content"], catalog)).toEqual({
      ok: false,
      unknown: ["validate_content"],
    });
  });
});
