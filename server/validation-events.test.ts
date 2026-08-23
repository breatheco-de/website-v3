import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { listEvents } from "./events/event-store";
import {
  emitValidationIssueWorkflowEvent,
  resolveSiteForIssue,
} from "./validation-events";
import type { StoredValidationIssue } from "../scripts/validation/shared/types";

const TEST_SITE = "site_test-validation-events";

function sampleIssue(overrides?: Partial<StoredValidationIssue>): StoredValidationIssue {
  return {
    id: "issue-1",
    code: "TITLE_TOO_SHORT",
    severity: "warning",
    message: "too short",
    category: "seo",
    validator: "seo-depth",
    file: "site_4geeks-com/landings/foo/en.yml",
    lastRunAt: new Date().toISOString(),
    targets: [{ type: "entry", entryKey: "landing/foo/en", url: "/en/foo" }],
    ...overrides,
  };
}

describe("validation-events", () => {
  beforeEach(() => {
    const dbPath = path.join("data", TEST_SITE.replace(/\//g, "-"), "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  afterEach(() => {
    const dbPath = path.join("data", TEST_SITE.replace(/\//g, "-"), "app.db");
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it("resolveSiteForIssue prefers site_* file prefix", () => {
    const issue = sampleIssue();
    expect(resolveSiteForIssue(issue)).toBe("site_4geeks-com");
    expect(resolveSiteForIssue(issue, "site_other")).toBe("site_other");
  });

  it("resolveSiteForIssue falls back to request site", () => {
    const issue = sampleIssue({ file: "landings/foo/en.yml" });
    expect(resolveSiteForIssue(issue)).toBeNull();
    expect(resolveSiteForIssue(issue, "site_4geeks-com")).toBe("site_4geeks-com");
  });

  it("emitValidationIssueWorkflowEvent writes claim payload with actor", () => {
    const issue = sampleIssue();
    const actor = { type: "mcp" as const, client: "Cursor", model: "claude-4" };
    emitValidationIssueWorkflowEvent({
      type: "validation_issue_claimed",
      site: TEST_SITE,
      issue,
      author: "jane.doe",
      actor,
    });
    const listed = listEvents({ site: TEST_SITE, type: "validation_issue_claimed", limit: 5 });
    expect(listed.length).toBe(1);
    expect(listed[0]?.attribution[0]?.author).toBe("jane.doe");
    expect(listed[0]?.payload).toMatchObject({
      issueId: "issue-1",
      code: "TITLE_TOO_SHORT",
      actor,
    });
    expect(listed[0]?.resource).toMatchObject({
      contentType: "landing",
      slug: "foo",
      locale: "en",
    });
  });

  it("emitValidationIssueWorkflowEvent writes reopen with prior completion", () => {
    const issue = sampleIssue();
    emitValidationIssueWorkflowEvent({
      type: "validation_issue_reopened",
      site: TEST_SITE,
      issue,
      author: "agent-a",
      priorCompletion: {
        completedBy: "agent-a",
        completedAt: "2026-01-01T00:00:00.000Z",
        actor: { type: "mcp", client: "Cursor" },
      },
    });
    const listed = listEvents({ site: TEST_SITE, type: "validation_issue_reopened", limit: 5 });
    expect(listed[0]?.payload).toMatchObject({
      priorCompletedBy: "agent-a",
      priorActor: { type: "mcp", client: "Cursor" },
    });
  });
});
