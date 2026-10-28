import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { clearSiteSqliteCacheForTests } from "../db";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { setDecisionClientForTests, type DecisionClient } from "../ai/decisions";
import { createProposalService, type ProposalEntryInput } from "./service";
import { brandTerms, type EvidenceSource } from "./evidence-match";

const SITE = `site_evidence-test-${Date.now()}`;

function rmSite(): void {
  const dir = path.join("data", SITE.replace(/\//g, "-"));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

const alice = { username: "alice", actor: { type: "mcp" as const, role: "copy_editor", model: "m", client: "c" } };
const bob = { username: "bob", actor: { type: "mcp" as const, role: "proposal_reviewer", model: "m", client: "c" } };

const press: EvidenceSource = {
  site: "site_parent",
  domain: "parent.com",
  database: "press_mentions",
  label: "Press Mentions",
  config: { enabled: true, proves: ["press_coverage"], proof_field: "link_url", match_fields: ["organization", "tags"] },
  rows: [{ title: "Bahamas", organization: "Government of the Bahamas", tags: ["Harvard", "Oxford"], link_url: "https://a" }],
};

/** Jev says yes to every candidate name. */
const yesClient: DecisionClient = {
  async decide(req) {
    const answers = Object.fromEntries(Object.keys(req.questions).map((k) => [k, { noul: 0.95 }]));
    return { status: "ok", model: "jev-test", answers };
  },
};

function makeService(live: Record<string, unknown> = { "call_to_action.title": "Old title" }) {
  return createProposalService({
    site: SITE,
    issueExists: () => true,
    captureBaseline: (entry) => {
      const values: Record<string, unknown> = {};
      for (const u of entry.updates) values[u.field_path] = live[u.field_path];
      return { values };
    },
    applyUpdates: async () => ({ ok: true }),
    evidenceSources: async () => ({ sources: [press], brand: brandTerms(["4Geeks Academy"]), brandLabel: "4Geeks Academy" }),
  });
}

function entry(value: string): ProposalEntryInput {
  return { contentType: "blog", slug: "hello", locale: "en", updates: [{ field_path: "call_to_action.title", value }] };
}

const SUMMARY = "Update the CTA title to mention the partnership that the press covered last month. ".repeat(2);

describe("evidence check (classifyLive + apply)", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(SITE, { skipBackup: true });
    setDecisionClientForTests(yesClient);
  });

  afterEach(() => {
    setDecisionClientForTests(null);
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  it("sourced names pass; a new unmatched name refuses apply until staff dismiss it", async () => {
    const svc = makeService();
    const created = await svc.create(
      { title: "CTA", summary: SUMMARY, entries: [entry("Chosen alongside Harvard and Stanford University.")] },
      alice,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const ctx = await svc.classifyLive(svc.get(created.proposal.id)!);
    const statuses = Object.fromEntries((ctx?.evidence?.claims ?? []).map((c) => [c.name, c.status]));
    expect(statuses.Harvard).toBe("sourced");
    expect(statuses["Stanford University"]).toBe("no_evidence");
    expect(ctx?.evidence_block).toBe(true);

    const refused = await svc.update(created.proposal.id, "apply", bob);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.code).toBe("evidence_missing");

    const short = svc.dismissEvidenceName(created.proposal.id, { name: "Stanford University", reason: "no", by: "staff" });
    expect(short.ok).toBe(false);

    const dismissed = svc.dismissEvidenceName(created.proposal.id, {
      name: "Stanford University",
      reason: "Example employer in the article, not a partner",
      by: "staff",
    });
    expect(dismissed.ok).toBe(true);
    const after = await svc.classifyLive(svc.get(created.proposal.id)!);
    expect(after?.evidence_block).toBeUndefined();
    expect(after?.evidence?.claims.find((c) => c.name === "Stanford University")?.status).toBe("dismissed");
  });

  it("a name already on the live page never blocks", async () => {
    const svc = makeService({ "call_to_action.title": "Chosen alongside Stanford University." });
    const created = await svc.create(
      { title: "CTA", summary: SUMMARY, entries: [entry("Chosen alongside Stanford University, now in 3 countries.")] },
      alice,
    );
    if (!created.ok) throw new Error("create");
    const ctx = await svc.classifyLive(svc.get(created.proposal.id)!);
    expect(ctx?.evidence?.claims.find((c) => c.name === "Stanford University")?.status).toBe("already_live");
    expect(ctx?.evidence_block).toBeUndefined();
  });

  it("Jev unavailable: only known names are matched and nothing blocks", async () => {
    setDecisionClientForTests({ async decide() { return { status: "unavailable", reason: "timeout" }; } });
    const svc = makeService();
    const created = await svc.create(
      { title: "CTA", summary: SUMMARY, entries: [entry("Chosen alongside Harvard and Stanford University.")] },
      alice,
    );
    if (!created.ok) throw new Error("create");
    const ctx = await svc.classifyLive(svc.get(created.proposal.id)!);
    expect(ctx?.evidence?.outcome).toBe("unavailable");
    expect(ctx?.evidence?.claims.map((c) => c.name)).toEqual(["Harvard"]);
    expect(ctx?.evidence_block).toBeUndefined();
    expect(ctx?.agent_preview.warnings.some((w) => w.code === "evidence_check_unavailable")).toBe(true);
  });
});
