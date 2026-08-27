import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listCacheIssuesFromStore,
  ValidationCacheService,
} from "./validationCacheService";
import type { ContentFile, ValidatorResult } from "../../scripts/validation/shared/types";
import { listEvents } from "../events/event-store";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "val-cache-complete-"));
}

function metaValidator(
  errors: Array<{ code: string; message: string; file: string }>,
): ValidatorResult {
  return {
    name: "meta",
    category: "seo",
    errors: errors.map((e) => ({
      type: "error" as const,
      code: e.code,
      message: e.message,
      file: e.file,
    })),
    warnings: [],
  };
}

describe("validation cache soft-complete", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("completeIssue hides from open counts and resurfaces on rewrite", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);

    const file: ContentFile = {
      slug: "home",
      title: "Home",
      type: "page",
      locale: "en",
      filePath: path.join(root, "pages/home/en.yml"),
      url: "/en/home",
    };
    fs.mkdirSync(path.dirname(file.filePath), { recursive: true });
    fs.writeFileSync(file.filePath, "meta: {}\nsections: []\n");

    cache.applyValidatorResults(
      [
        metaValidator([
          {
            code: "CONTENT_NOT_IN_SITEMAP",
            message: "Content file has no sitemap entry: /en/home",
            file: file.filePath,
          },
        ]),
      ],
      { contentFiles: [file], entryKeys: ["page/home/en"] },
    );

    const issues = cache.getIssuesByEntryKey("page/home/en");
    expect(issues.length).toBe(1);
    const issueId = issues[0]!.id;

    const marked = await cache.completeIssue(issueId, "agent:test");
    expect(marked.ok).toBe(true);
    expect(cache.isIssueCompleted(issueId)).toBe(true);
    expect(cache.getOpenIssuesByEntryKey("page/home/en")).toHaveLength(0);

    const page = cache.getByEntryKey("page/home/en");
    expect(page?.errors ?? []).toHaveLength(0);

    const listed = listCacheIssuesFromStore(cache, { entryKey: "page/home/en" });
    expect(listed.issues).toHaveLength(0);

    // Same issue rewritten → completion cleared (resurfaced)
    cache.applyValidatorResults(
      [
        metaValidator([
          {
            code: "CONTENT_NOT_IN_SITEMAP",
            message: "Content file has no sitemap entry: /en/home",
            file: file.filePath,
          },
        ]),
      ],
      { contentFiles: [file], entryKeys: ["page/home/en"] },
    );
    expect(cache.isIssueCompleted(issueId)).toBe(false);
    expect(cache.getOpenIssuesByEntryKey("page/home/en")).toHaveLength(1);
  });

  it("uncompleteIssue and clear when issue removed", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);

    const file: ContentFile = {
      slug: "home",
      title: "Home",
      type: "page",
      locale: "en",
      filePath: path.join(root, "pages/home/en.yml"),
      url: "/en/home",
    };
    fs.mkdirSync(path.dirname(file.filePath), { recursive: true });
    fs.writeFileSync(file.filePath, "meta: {}\nsections: []\n");

    cache.applyValidatorResults(
      [
        metaValidator([
          {
            code: "CONTENT_NOT_IN_SITEMAP",
            message: "missing",
            file: file.filePath,
          },
        ]),
      ],
      { contentFiles: [file], entryKeys: ["page/home/en"] },
    );
    const issueId = cache.getIssuesByEntryKey("page/home/en")[0]!.id;
    await cache.completeIssue(issueId, "staff");

    await cache.uncompleteIssue(issueId);
    expect(cache.isIssueCompleted(issueId)).toBe(false);

    await cache.completeIssue(issueId, "staff");
    // Validator runs clean → issue gone → completion GC'd
    cache.applyValidatorResults([metaValidator([])], {
      contentFiles: [file],
      entryKeys: ["page/home/en"],
    });
    expect(cache.getIssueById(issueId)).toBeUndefined();
    expect(cache.isIssueCompleted(issueId)).toBe(false);
  });
});

describe("validation cache claims", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  function seedIssue(cache: ValidationCacheService, root: string) {
    const file: ContentFile = {
      slug: "home",
      title: "Home",
      type: "page",
      locale: "en",
      filePath: path.join(root, "pages/home/en.yml"),
      url: "/en/home",
    };
    fs.mkdirSync(path.dirname(file.filePath), { recursive: true });
    fs.writeFileSync(file.filePath, "meta: {}\nsections: []\n");
    cache.applyValidatorResults(
      [
        metaValidator([
          {
            code: "CONTENT_NOT_IN_SITEMAP",
            message: "missing",
            file: file.filePath,
          },
        ]),
      ],
      { contentFiles: [file], entryKeys: ["page/home/en"] },
    );
    return {
      file,
      issueId: cache.getIssuesByEntryKey("page/home/en")[0]!.id,
    };
  }

  it("blocks claim by another author and allows refresh by owner", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const { issueId } = seedIssue(cache, root);

    const first = await cache.claimIssue(issueId, "agent-a");
    expect(first.ok).toBe(true);

    const conflict = await cache.claimIssue(issueId, "agent-b");
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.code).toBe("issue_already_claimed");

    const refresh = await cache.claimIssue(issueId, "agent-a");
    expect(refresh.ok).toBe(true);
  });

  it("complete clears claim; rewrite clears complete but keeps claim", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const { file, issueId } = seedIssue(cache, root);

    await cache.claimIssue(issueId, "agent-a");
    expect(cache.isClaimActive(issueId)).toBe(true);

    await cache.completeIssue(issueId, "agent-a");
    expect(cache.isClaimActive(issueId)).toBe(false);
    expect(cache.isIssueCompleted(issueId)).toBe(true);

    await cache.uncompleteIssue(issueId);
    await cache.claimIssue(issueId, "agent-a");

    cache.applyValidatorResults(
      [
        metaValidator([
          {
            code: "CONTENT_NOT_IN_SITEMAP",
            message: "missing",
            file: file.filePath,
          },
        ]),
      ],
      { contentFiles: [file], entryKeys: ["page/home/en"] },
    );
    expect(cache.isIssueCompleted(issueId)).toBe(false);
    expect(cache.isClaimActive(issueId)).toBe(true);
  });

  it("updateIssue release with force clears foreign claim", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const { issueId } = seedIssue(cache, root);

    await cache.claimIssue(issueId, "agent-a");
    const denied = await cache.updateIssue(issueId, "release", "agent-b");
    expect(denied.ok).toBe(false);

    const forced = await cache.updateIssue(issueId, "release", "staff", {
      staffForceRelease: true,
    });
    expect(forced.ok).toBe(true);
    expect(cache.isClaimActive(issueId)).toBe(false);
  });

  it("stores actor on claim and complete; re-claim overwrites actor", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const { issueId } = seedIssue(cache, root);

    const mcpActor = { type: "mcp" as const, client: "Cursor", model: "gpt-4" };
    await cache.claimIssue(issueId, "jane", mcpActor);
    expect(cache.getActiveClaim(issueId)?.actor).toEqual(mcpActor);

    const uiActor = { type: "ui" as const };
    await cache.claimIssue(issueId, "jane", uiActor);
    expect(cache.getActiveClaim(issueId)?.actor).toEqual(uiActor);

    await cache.completeIssue(issueId, "jane", mcpActor);
    const completion = cache.getCompletion(issueId);
    expect(completion?.actor).toEqual(mcpActor);

    const listed = listCacheIssuesFromStore(cache, { entryKey: "page/home/en", includeCompleted: true });
    expect(listed.issues[0]?.claimed).toBeUndefined();
    expect(listed.issues[0]?.completed?.actor).toEqual(mcpActor);
  });

  it("stores report on claim and complete; re-claim preserves report", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const { issueId } = seedIssue(cache, root);

    const claimReport = "Will fix missing sitemap entry by updating meta redirects.";
    await cache.claimIssue(issueId, "jane", { type: "mcp", client: "Cursor" }, claimReport);
    expect(cache.getActiveClaim(issueId)?.report).toBe(claimReport);

    const refresh = await cache.claimIssue(issueId, "jane");
    expect(refresh.ok).toBe(true);
    expect(cache.getActiveClaim(issueId)?.report).toBe(claimReport);

    const completeReport = "Added /en/home to meta.redirects via update_fields on pages/home/en.yml.";
    await cache.completeIssue(issueId, "jane", { type: "mcp", client: "Cursor" }, completeReport);
    expect(cache.getCompletion(issueId)?.report).toBe(completeReport);

    const listed = listCacheIssuesFromStore(cache, { entryKey: "page/home/en", includeCompleted: true });
    expect(listed.issues[0]?.completed?.report).toBe(completeReport);
  });

  it("emits validation_issue_reopened when rewrite clears completion", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const { file, issueId } = seedIssue(cache, root);

    await cache.completeIssue(issueId, "agent-a", { type: "mcp", client: "Cursor" });

    cache.applyValidatorResults(
      [
        metaValidator([
          {
            code: "CONTENT_NOT_IN_SITEMAP",
            message: "missing",
            file: file.filePath,
          },
        ]),
      ],
      { contentFiles: [file], entryKeys: ["page/home/en"] },
    );

    const listed = listEvents({
      site: cache.getSiteFolder(),
      type: "validation_issue_reopened",
      limit: 5,
    });
    expect(listed.length).toBe(1);
    expect(listed[0]?.attribution[0]?.author).toBe("agent-a");
    expect(listed[0]?.payload).toMatchObject({
      priorCompletedBy: "agent-a",
      priorActor: { type: "mcp", client: "Cursor" },
    });
  });
});
