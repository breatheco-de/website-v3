import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAIM_TTL_MS,
  ValidationCacheService,
} from "./validationCacheService";
import type { ContentFile, ValidatorResult } from "../../scripts/validation/shared/types";

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "val-cache-claim-entry-"));
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

async function seedIssue(
  cache: ValidationCacheService,
  root: string,
  opts: { type: string; slug: string; locale: string; url: string },
): Promise<string> {
  const file: ContentFile = {
    slug: opts.slug,
    title: opts.slug,
    type: opts.type,
    locale: opts.locale,
    filePath: path.join(root, `${opts.type}s/${opts.slug}/${opts.locale}.yml`),
    url: opts.url,
  };
  fs.mkdirSync(path.dirname(file.filePath), { recursive: true });
  fs.writeFileSync(file.filePath, "meta: {}\nsections: []\n");
  const entryKey = `${opts.type}/${opts.slug}/${opts.locale}`;
  cache.applyValidatorResults(
    [
      metaValidator([
        {
          code: "CONTENT_NOT_IN_SITEMAP",
          message: `Content file has no sitemap entry: ${opts.url}`,
          file: file.filePath,
        },
      ]),
    ],
    { contentFiles: [file], entryKeys: [entryKey] },
  );
  const issues = cache.getIssuesByEntryKey(entryKey);
  expect(issues.length).toBeGreaterThanOrEqual(1);
  return issues[0]!.id;
}

describe("authorHasActiveClaimOnEntry / refreshClaimsForEntry", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    roots.length = 0;
  });

  it("matches same locale claim and misses other locale", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const enId = await seedIssue(cache, root, {
      type: "page",
      slug: "home",
      locale: "en",
      url: "/en/home",
    });
    await seedIssue(cache, root, {
      type: "page",
      slug: "home",
      locale: "es",
      url: "/es/inicio",
    });

    await cache.claimIssue(enId, "alice", { type: "mcp", name: "alice" }, "x".repeat(80));

    const en = cache.authorHasActiveClaimOnEntry({
      author: "alice",
      contentType: "page",
      slug: "home",
      locale: "en",
    });
    expect(en.has_active_claim).toBe(true);
    expect(en.claim_issue_ids).toContain(enId);

    const es = cache.authorHasActiveClaimOnEntry({
      author: "alice",
      contentType: "page",
      slug: "home",
      locale: "es",
    });
    expect(es.has_active_claim).toBe(false);
    expect(es.claim_issue_ids).toEqual([]);
  });

  it("rejects wrong author and expired claims", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const issueId = await seedIssue(cache, root, {
      type: "page",
      slug: "home",
      locale: "en",
      url: "/en/home",
    });
    await cache.claimIssue(issueId, "alice", { type: "mcp", name: "alice" }, "x".repeat(80));

    expect(
      cache.authorHasActiveClaimOnEntry({
        author: "bob",
        contentType: "page",
        slug: "home",
        locale: "en",
      }).has_active_claim,
    ).toBe(false);

    const past = Date.now() + CLAIM_TTL_MS + 1000;
    expect(
      cache.authorHasActiveClaimOnEntry({
        author: "alice",
        contentType: "page",
        slug: "home",
        locale: "en",
        nowMs: past,
      }).has_active_claim,
    ).toBe(false);
  });

  it("refreshClaimsForEntry extends expiresAt for the author", async () => {
    const root = tempRoot();
    roots.push(root);
    const cache = new ValidationCacheService(root);
    const issueId = await seedIssue(cache, root, {
      type: "blog",
      slug: "post",
      locale: "en",
      url: "/en/blog/post",
    });
    const claimed = await cache.claimIssue(
      issueId,
      "alice",
      { type: "mcp", name: "alice" },
      "x".repeat(80),
    );
    expect(claimed.ok).toBe(true);
    if (!claimed.ok) return;
    const before = claimed.claim.expiresAt;

    const t0 = Date.now();
    const refreshed = await cache.refreshClaimsForEntry({
      author: "alice",
      contentType: "blog",
      slug: "post",
      locale: "en",
      nowMs: t0,
    });
    expect(refreshed.refreshed).toBe(1);
    expect(refreshed.claim_issue_ids).toEqual([issueId]);

    const active = cache.getActiveClaim(issueId, t0);
    expect(active).toBeDefined();
    expect(active!.expiresAt).toBe(new Date(t0 + CLAIM_TTL_MS).toISOString());
    expect(active!.expiresAt >= before).toBe(true);
  });
});
