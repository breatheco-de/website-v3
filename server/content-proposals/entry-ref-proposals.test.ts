import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearSiteSqliteCacheForTests } from "../db";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { ContentIndex } from "../content-index";
import { resetRegistry } from "../content-types";
import { resolveEntryRef } from "../entry-ref";
import { createProposalService } from "./service";

const SITE = `site_entry-ref-proposals-${Date.now()}`;
const alice = { username: "alice", actor: { type: "mcp" as const, role: "copy_editor" } };
const bob = { username: "bob", actor: { type: "mcp" as const, role: "seo_specialist" } };
const summary = "Fix the call to action on the Spanish empty-array guide so it names the right product. ".repeat(2);

const tmpDirs: string[] = [];

function rmSite(): void {
  const dir = path.join("data", SITE);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

function write(root: string, rel: string, body: string) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

function makeIndex(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "entry-ref-proposals-"));
  tmpDirs.push(root);
  write(root, "content-types.yml", "how-to:\n  directory: how-to\n  url_pattern:\n    en: /en/how-to/:slug\n    es: /es/how-to/:slug\n");
  write(root, "how-to/javascript-empty-array/en.yml", "title: Empty array\n");
  write(root, "how-to/javascript-empty-array/es.yml", "slug: array-vacio-javascript\ntitle: Array vacío\n");
  const ci = new ContentIndex(root);
  resetRegistry();
  ci.scanFast();
  ci.scanSlow();
  return ci;
}

function makeService(ci: ContentIndex) {
  return createProposalService({
    site: SITE,
    issueExists: () => true,
    captureBaseline: () => ({ values: { "call_to_action.title": "Old" } }),
    applyUpdates: async () => ({ ok: true }),
    resolveEntryRef: (ref) =>
      resolveEntryRef(ci, { contentType: ref.contentType, ref: ref.slug, locale: ref.locale, localeExplicit: ref.localeExplicit }),
  });
}

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
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  resetRegistry();
});

describe("proposals name pages by any slug", () => {
  it("stores the page ID when edits are filed with the Spanish address", async () => {
    const svc = makeService(makeIndex());
    const res = await svc.create(
      {
        title: "Spanish CTA",
        summary,
        entries: [
          {
            contentType: "how-to",
            slug: "array-vacio-javascript",
            locale: "es",
            updates: [{ field_path: "call_to_action.title", value: "Nuevo" }],
          },
        ],
      },
      alice,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.entries[0]?.slug).toBe("javascript-empty-array");
    expect(res.proposal.entries[0]?.locale).toBe("es");
    expect(res.warnings?.map((w) => w.code)).toContain("slug_resolved");
  });

  it("refuses to accept an idea whose reserved address is another spelling of an existing page", async () => {
    const svc = makeService(makeIndex());
    const idea = await svc.create(
      {
        kind: "idea",
        title: "New empty array guide",
        summary,
        related_entries: [{ contentType: "how-to", slug: "Javascript_Empty_Array", locale: "en" }],
        idea_funnel: { stage: "awareness", products: "all" },
      },
      alice,
    );
    expect(idea.ok).toBe(true);
    if (!idea.ok) return;
    const accepted = await svc.update(idea.proposal.id, "accept", {
      ...bob,
      next_step: "File field edits for this reserved slug once the brief is ready.",
      accepted_entry: { contentType: "how-to", slug: "Javascript_Empty_Array", locale: "en" },
    });
    expect(accepted.ok).toBe(false);
    if (!accepted.ok) {
      expect(accepted.code).toBe("idea_slug_matches_existing_page");
      expect((accepted as { details?: { existing_entry_id?: string } }).details?.existing_entry_id).toBe(
        "javascript-empty-array",
      );
    }
  });

  it("accepts an idea on the exact page ID of an existing page", async () => {
    const svc = makeService(makeIndex());
    const idea = await svc.create(
      {
        kind: "idea",
        title: "Refresh the empty array guide",
        summary,
        related_entries: [{ contentType: "how-to", slug: "javascript-empty-array", locale: "en" }],
      },
      alice,
    );
    if (!idea.ok) throw new Error(idea.error);
    const accepted = await svc.update(idea.proposal.id, "accept", {
      ...bob,
      next_step: "Refresh the examples in a follow-up edits proposal on this page.",
      accepted_entry: { contentType: "how-to", slug: "javascript-empty-array", locale: "en" },
    });
    expect(accepted.ok).toBe(true);
  });

  it("never resolves follow-through edits onto an existing page", async () => {
    const ci = makeIndex();
    const resolved: string[] = [];
    const svc = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: {} }),
      applyUpdates: async () => ({ ok: true }),
      resolveEntryRef: (ref) => {
        resolved.push(ref.slug);
        return resolveEntryRef(ci, { contentType: ref.contentType, ref: ref.slug });
      },
    });
    await svc.create(
      {
        title: "Follow-through",
        summary,
        implements_proposal_id: "missing-idea",
        entries: [
          {
            contentType: "how-to",
            slug: "array-vacio-javascript",
            locale: "es",
            updates: [{ field_path: "title", value: "x" }],
          },
        ],
      },
      alice,
    );
    expect(resolved).not.toContain("array-vacio-javascript");
  });
});
