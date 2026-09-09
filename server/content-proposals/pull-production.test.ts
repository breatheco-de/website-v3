import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { clearSiteSqliteCacheForTests } from "../db";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import {
  createProposalService,
  exportAllProposals,
  replaceProposalsFromSnapshot,
  type ProposalRecord,
} from "./service";

const SITE = `site_proposal-pull-${Date.now()}`;

function rmSite(): void {
  const dir = path.join("data", SITE.replace(/\//g, "-"));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function sampleSnapshot(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: "prop-from-prod",
    site: "site_production_name",
    fingerprint: "fp1",
    status: "open",
    kind: "edits",
    category: "content.field",
    title: "Prod proposal",
    summary: "A".repeat(80),
    rationale: null,
    documentation: {},
    related_issue_ids: [],
    proposer_username: "agent",
    proposer_actor: { type: "mcp" },
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_100_000,
    claim: null,
    tags: [],
    search_text: "prod proposal",
    created_agent_session_id: null,
    promote_on_apply: false,
    review_mode: "soft",
    open_blocker_count: 1,
    entries: [
      {
        id: 42,
        proposal_id: "prop-from-prod",
        entry_key: "blog/hello",
        contentType: "blog",
        slug: "hello",
        locale: "en",
        variant: null,
        variant_fingerprint: null,
        status: "pending",
        ops: [{ field_path: "meta.title", value: "Hi" }],
        baseline_context: { values: { "meta.title": "Old" } },
        last_error: null,
        applied_at: null,
        applied_by: null,
      },
    ],
    blockers: [
      {
        id: 7,
        proposal_id: "prop-from-prod",
        kind: "blocker",
        body: "B".repeat(80),
        status: "open",
        author: "reviewer",
        created_at: 1_700_000_050_000,
        resolved_at: null,
        resolved_by: null,
        resolve_note: null,
        agent_session_id: null,
      },
    ],
    ...overrides,
  };
}

describe("replaceProposalsFromSnapshot", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(SITE, { skipBackup: true });
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  it("replaces local rows and remaps site while preserving ids", async () => {
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: { "meta.title": "Local" } }),
      applyUpdates: async () => ({ ok: true }),
    });
    const created = await svc.create(
      {
        title: "Local only",
        summary: "C".repeat(80),
        entries: [
          {
            contentType: "blog",
            slug: "local",
            locale: "en",
            updates: [{ field_path: "meta.title", value: "X" }],
          },
        ],
      },
      { username: "local" },
    );
    expect(created.ok).toBe(true);

    const count = replaceProposalsFromSnapshot(SITE, [sampleSnapshot()]);
    expect(count).toBe(1);

    const dumped = exportAllProposals(SITE);
    expect(dumped).toHaveLength(1);
    expect(dumped[0]!.id).toBe("prop-from-prod");
    expect(dumped[0]!.site).toBe(SITE);
    expect(dumped[0]!.entries[0]!.id).toBe(42);
    expect(dumped[0]!.blockers[0]!.id).toBe(7);
    expect(dumped[0]!.open_blocker_count).toBe(1);
  });
});

describe("pullProductionProposals", () => {
  const originalFetch = global.fetch;
  const originalEnv = process.env.PRODUCTION_STAFF_TOKEN;

  beforeEach(async () => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(SITE, { skipBackup: true });
    delete process.env.PRODUCTION_STAFF_TOKEN;
    const { resetProductionStaffTokenForTests } = await import("../dev-production-fetch");
    resetProductionStaffTokenForTests();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
    if (originalEnv === undefined) delete process.env.PRODUCTION_STAFF_TOKEN;
    else process.env.PRODUCTION_STAFF_TOKEN = originalEnv;
    const { resetProductionStaffTokenForTests } = await import("../dev-production-fetch");
    resetProductionStaffTokenForTests();
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  it("requires a production staff token", async () => {
    const { pullProductionProposals } = await import("./pull-production");
    const result = await pullProductionProposals(SITE, "https://prod.example");
    expect(result.success).toBe(false);
    expect(result.code).toBe("production_staff_token_required");
    expect(result.productionOrigin).toBe("https://prod.example");
  });

  it("imports production export using env token", async () => {
    process.env.PRODUCTION_STAFF_TOKEN = "token-abc";
    const { resetProductionStaffTokenForTests } = await import("../dev-production-fetch");
    resetProductionStaffTokenForTests();

    global.fetch = vi.fn(async () => {
      return new Response(JSON.stringify({ proposals: [sampleSnapshot()] }), { status: 200 });
    }) as typeof fetch;

    const { pullProductionProposals } = await import("./pull-production");
    const result = await pullProductionProposals(SITE, "https://prod.example");

    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
    expect(exportAllProposals(SITE)).toHaveLength(1);
    expect(String(global.fetch).length).toBeGreaterThan(0);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/admin/proposals/export"),
      expect.objectContaining({ method: "GET" }),
    );
  });
});
