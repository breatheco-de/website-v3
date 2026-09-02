import { mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_IGNORE_RULE_INPUTS } from "@shared/runtime-issues-ignore";
import { fingerprintNotFound } from "@shared/runtime-issues";
import { gcs } from "./gcs";
import {
  _resetRuntimeIssuesForTests,
  _setRuntimeIssuesProductionForTests,
  addIgnoreRules,
  deleteRuntimeIssuesByFingerprints,
  listRuntimeIssues,
  loadRuntimeIssuesForSite,
  pullRuntimeIssuesFromGcs,
  purgeIssuesMatchingIgnoreRules,
  recordPublicNotFound,
  resetRuntimeIssuesForSite,
  saveIssueProbe,
  setDropScrapers,
  getRuntimeIssuesLocalPath,
} from "./runtime-issues-store";

const BUILTIN_RULE_COUNT = BUILTIN_IGNORE_RULE_INPUTS.length;

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("runtime-issues-store", () => {
  let tmp: string;

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    _resetRuntimeIssuesForTests();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  function root() {
    tmp = mkdtempSync(path.join(os.tmpdir(), "runtime-issues-"));
    return tmp;
  }

  it("records Googlebot page 404s with byHour and search_crawler", () => {
    const contentRoot = root();
    const ts = Date.UTC(2026, 7, 14, 15, 0, 0);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/es/blog/foo",
        userAgent: "Googlebot/2.1",
        ts,
      }),
    ).toBe(true);
    const listed = listRuntimeIssues("site_test", { contentRoot });
    expect(listed.issues).toHaveLength(1);
    expect(listed.issues[0].sources).toContain("search_crawler");
    expect(listed.issues[0].uaBucket).toBe("search_crawler");
    expect(listed.issues[0].likelyBot).toBeFalsy();
    expect(listed.issues[0].byHour?.["2026-08-14T15"]?.total).toBe(1);
    expect(listed.issues[0].byHour?.["2026-08-14T15"]?.search_crawler).toBe(1);
  });

  it("merges query attribution on the same path", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/en/scholarship/foo",
      querySearch: "utm_source=meta&utm_campaign=q1",
      userAgent: CHROME,
    });
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/en/scholarship/foo",
      querySearch: "utm_campaign=q2&gclid=abc",
      userAgent: CHROME,
    });
    const listed = listRuntimeIssues("site_test", { contentRoot });
    expect(listed.issues).toHaveLength(1);
    expect(listed.issues[0].queryAttribution?.source).toEqual(["meta"]);
    expect(listed.issues[0].queryAttribution?.campaign).toEqual(["q1", "q2"]);
    expect(listed.issues[0].queryAttribution?.other?.gclid).toEqual(["abc"]);
  });

  it("does not ingest staff preview query params", () => {
    const contentRoot = root();
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/en/scholarship/foo",
        querySearch: "force_variant=draft-a",
        userAgent: CHROME,
      }),
    ).toBe(false);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(0);
  });

  it("drops sensitive query keys from attribution", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/en/missing",
      querySearch: "utm_source=meta&token=secret&ref=abc",
      userAgent: CHROME,
    });
    const listed = listRuntimeIssues("site_test", { contentRoot });
    expect(listed.issues[0].queryAttribution?.source).toEqual(["meta"]);
    expect(listed.issues[0].queryAttribution?.other?.token).toBeUndefined();
    expect(listed.issues[0].queryAttribution?.other?.ref).toEqual(["abc"]);
  });

  it("drops curl and hashed JS", () => {
    const contentRoot = root();
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/es/blog/foo",
        userAgent: "curl/8.0",
      }),
    ).toBe(false);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/FooterDefault-BzTB3rd2.js",
        userAgent: CHROME,
        referrer: "https://4geeks.com/",
      }),
    ).toBe(false);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(0);
  });

  it("keeps a 4Geeks-referrer gif and tags internal", () => {
    const contentRoot = root();
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/static/images/loader.gif",
        userAgent: CHROME,
        referrer: "https://classrecordings.4geeks.com/",
      }),
    ).toBe(true);
    const listed = listRuntimeIssues("site_test", { contentRoot });
    expect(listed.issues[0].sources).toContain("internal");
  });

  it("resetRuntimeIssuesForSite empties the store", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/es/blog/foo",
      userAgent: CHROME,
    });
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(1);
    const empty = resetRuntimeIssuesForSite("site_test", contentRoot);
    expect(Object.keys(empty.issues)).toHaveLength(0);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(0);
  });

  it("saveIssueProbe persists lastProbe and a later 404 keeps it", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/hello",
      userAgent: CHROME,
    });
    const listed = listRuntimeIssues("site_test", { contentRoot });
    const fp = listed.issues[0].fingerprint;
    const saved = saveIssueProbe(
      "site_test",
      fp,
      {
        at: 1_700_000_000_000,
        status: "redirect",
        destination: "/us/page",
        chained: false,
        hops: ["/hello", "/us/page"],
        httpStatus: 200,
        matchType: "exact",
      },
      contentRoot,
    );
    expect(saved?.lastProbe?.status).toBe("redirect");
    expect(saved?.lastProbe?.destination).toBe("/us/page");

    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/hello",
      userAgent: CHROME,
      ts: Date.now(),
    });
    const again = listRuntimeIssues("site_test", { contentRoot }).issues[0];
    expect(again.lastProbe?.status).toBe("redirect");
    expect(again.lastProbe?.destination).toBe("/us/page");
  });

  it("saveIssueProbe returns null for an unknown fingerprint", () => {
    expect(saveIssueProbe("site_test", "missing", { at: 1, status: "not_found" }, root())).toBeNull();
  });

  it("pullRuntimeIssuesFromGcs replaces local issues then continues ingest", async () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/local-only",
      userAgent: CHROME,
    });
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/local-only"]);

    const prodFp = "prod-fp";
    const prodState = {
      version: 1 as const,
      updatedAt: Date.UTC(2026, 7, 1),
      issues: {
        [prodFp]: {
          fingerprint: prodFp,
          kind: "http.not_found" as const,
          path: "/prod-only",
          locale: "en",
          count: 4,
          firstSeen: Date.UTC(2026, 7, 1),
          lastSeen: Date.UTC(2026, 7, 14),
        },
      },
      recent: [],
    };
    vi.spyOn(gcs, "available", "get").mockReturnValue(true);
    const download = vi.spyOn(gcs, "downloadFirstExisting").mockResolvedValue({
      key: "site_test/sync/runtime-issues-state.json",
      data: Buffer.from(JSON.stringify(prodState), "utf-8"),
    });
    const upload = vi.spyOn(gcs, "upload");
    const debounced = vi.spyOn(gcs, "debouncedUpload");

    const pulled = await pullRuntimeIssuesFromGcs("site_test", contentRoot);
    expect(pulled).toMatchObject({
      success: true,
      pulled: true,
      gcsKey: "site_test/sync/runtime-issues-state.json",
      issueCount: 1,
    });
    expect(download).toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(debounced).not.toHaveBeenCalled();
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/prod-only"]);

    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/after-pull",
      userAgent: CHROME,
    });
    expect(
      listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path).sort(),
    ).toEqual(["/after-pull", "/prod-only"]);
    expect(upload).not.toHaveBeenCalled();
    expect(debounced).not.toHaveBeenCalled();
  });

  it("pullRuntimeIssuesFromGcs keeps local issues when GCS is unavailable", async () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/keep-me",
      userAgent: CHROME,
    });
    vi.spyOn(gcs, "available", "get").mockReturnValue(false);
    vi.spyOn(gcs, "initBootstrapFromEnv").mockImplementation(() => {});
    const download = vi.spyOn(gcs, "downloadFirstExisting");

    const pulled = await pullRuntimeIssuesFromGcs("site_test", contentRoot);
    expect(pulled.success).toBe(false);
    expect(pulled.pulled).toBe(false);
    expect(pulled.reason).toMatch(/GCS is unavailable/);
    expect(download).not.toHaveBeenCalled();
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/keep-me"]);
  });

  it("pullRuntimeIssuesFromGcs keeps local issues when GCS has no file", async () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/keep-me",
      userAgent: CHROME,
    });
    vi.spyOn(gcs, "available", "get").mockReturnValue(true);
    vi.spyOn(gcs, "downloadFirstExisting").mockResolvedValue(null);

    const pulled = await pullRuntimeIssuesFromGcs("site_test", contentRoot);
    expect(pulled.success).toBe(false);
    expect(pulled.reason).toMatch(/No runtime-issues file found/);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/keep-me"]);
  });

  it("skips recording when a path matches an ignore rule", () => {
    const contentRoot = root();
    addIgnoreRules("site_test", [{ kind: "locales", locales: ["us", "es"], rest: "/gone", label: "locale pair" }], { contentRoot });
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/us/gone",
        userAgent: CHROME,
      }),
    ).toBe(false);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/es/gone",
        userAgent: CHROME,
      }),
    ).toBe(false);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/us/keep",
        userAgent: CHROME,
      }),
    ).toBe(true);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/us/keep"]);
  });

  it("skips WordPress prefix builtins without a manual rule", () => {
    const contentRoot = root();
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/wordpress/2020/hello",
        userAgent: CHROME,
      }),
    ).toBe(false);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/wp/login",
        userAgent: CHROME,
      }),
    ).toBe(false);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/wp-json/wp/v2/posts",
        userAgent: CHROME,
      }),
    ).toBe(false);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/us/blog/real",
        userAgent: CHROME,
      }),
    ).toBe(true);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual([
      "/us/blog/real",
    ]);
  });

  it("addIgnoreRules deletes matching rows and reset keeps rules", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/us/old",
      userAgent: CHROME,
    });
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/us/keep",
      userAgent: CHROME,
    });
    const oldFp = listRuntimeIssues("site_test", { contentRoot }).issues.find((i) => i.path === "/us/old")!
      .fingerprint;
    const added = addIgnoreRules("site_test", [{ kind: "exact", path: "/us/old", label: "old" }], {
      contentRoot,
      seedPaths: ["/us/old"],
      purgeFingerprints: [oldFp],
    });
    expect(added.removed).toBe(1);
    expect(added.added).toBe(1);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/us/keep"]);
    const reset = resetRuntimeIssuesForSite("site_test", contentRoot);
    expect(Object.keys(reset.issues)).toHaveLength(0);
    // Reset clears 404 rows but keeps ignore rules (builtins + staff-added).
    expect(listRuntimeIssues("site_test", { contentRoot }).ignored).toHaveLength(
      BUILTIN_RULE_COUNT + 1,
    );
    expect(reset.dropScrapers).toBe(true);
  });

  it("addIgnoreRules purges selected fingerprints when the rule already exists", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/us/old",
      userAgent: CHROME,
    });
    const fp = listRuntimeIssues("site_test", { contentRoot }).issues[0].fingerprint;
    const first = addIgnoreRules(
      "site_test",
      [{ kind: "exact", path: "/us/old", label: "old" }],
      { contentRoot, seedPaths: ["/us/old"] },
    );
    expect(first.added).toBe(1);
    expect(first.removed).toBe(0);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(1);

    const second = addIgnoreRules(
      "site_test",
      [{ kind: "exact", path: "/us/old", label: "old" }],
      { contentRoot, seedPaths: ["/us/old"], purgeFingerprints: [fp] },
    );
    expect(second.added).toBe(0);
    expect(second.removed).toBe(1);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(0);
  });

  it("deleteRuntimeIssuesByFingerprints removes only targeted rows", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/us/a",
      userAgent: CHROME,
    });
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/us/b",
      userAgent: CHROME,
    });
    const listed = listRuntimeIssues("site_test", { contentRoot });
    const fpA = listed.issues.find((i) => i.path === "/us/a")!.fingerprint;
    const ignoredBefore = listed.ignored.length;
    const result = deleteRuntimeIssuesByFingerprints("site_test", [fpA], contentRoot);
    expect(result.removed).toBe(1);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/us/b"]);
    expect(listRuntimeIssues("site_test", { contentRoot }).ignored).toHaveLength(ignoredBefore);
  });

  it("deleteRuntimeIssuesByFingerprints returns 0 for empty input", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/us/a",
      userAgent: CHROME,
    });
    expect(deleteRuntimeIssuesByFingerprints("site_test", [], contentRoot).removed).toBe(0);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(1);
  });

  it("purgeIssuesMatchingIgnoreRules removes rows covered by ignore templates", () => {
    const contentRoot = root();
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/us/junk",
      userAgent: CHROME,
    });
    recordPublicNotFound({
      site: "site_test",
      contentRoot,
      path: "/us/real",
      userAgent: CHROME,
    });
    addIgnoreRules("site_test", [{ kind: "exact", path: "/us/junk", label: "junk" }], { contentRoot });
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path).sort()).toEqual([
      "/us/junk",
      "/us/real",
    ]);

    const purged = purgeIssuesMatchingIgnoreRules("site_test", contentRoot);
    expect(purged.removed).toBe(1);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/us/real"]);
  });

  it("purgeIssuesMatchingIgnoreRules removes stale wp-json rows via builtin prefix", () => {
    const contentRoot = root();
    const wpFp = fingerprintNotFound("site_test", "en", "/wp-json/Batch/v1");
    const realFp = fingerprintNotFound("site_test", "en", "/us/real");
    const ts = Date.UTC(2026, 7, 14);
    writeFileSync(
      getRuntimeIssuesLocalPath("site_test", contentRoot),
      JSON.stringify({
        version: 1,
        updatedAt: ts,
        issues: {
          [wpFp]: {
            fingerprint: wpFp,
            kind: "http.not_found",
            path: "/wp-json/Batch/v1",
            locale: "en",
            count: 3,
            firstSeen: ts,
            lastSeen: ts,
          },
          [realFp]: {
            fingerprint: realFp,
            kind: "http.not_found",
            path: "/us/real",
            locale: "en",
            count: 1,
            firstSeen: ts,
            lastSeen: ts,
          },
        },
        recent: [],
      }),
      "utf-8",
    );
    _resetRuntimeIssuesForTests();

    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path).sort()).toEqual([
      "/us/real",
      "/wp-json/Batch/v1",
    ]);

    const purged = purgeIssuesMatchingIgnoreRules("site_test", contentRoot);
    expect(purged.removed).toBe(1);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual(["/us/real"]);
  });

  it("setDropScrapers is future-only and does not delete existing rows", () => {
    const contentRoot = root();
    setDropScrapers("site_test", false, contentRoot);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/es/blog/foo",
        userAgent: "curl/8.0",
      }),
    ).toBe(true);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(1);
    setDropScrapers("site_test", true, contentRoot);
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(1);
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/es/blog/bar",
        userAgent: "curl/8.0",
      }),
    ).toBe(false);
    expect(listRuntimeIssues("site_test", { contentRoot }).dropScrapers).toBe(true);
  });

  it("treats empty local runtime-issues file as missing state", () => {
    const contentRoot = root();
    writeFileSync(getRuntimeIssuesLocalPath("site_test", contentRoot), "");
    const listed = listRuntimeIssues("site_test", { contentRoot });
    expect(listed.issues).toHaveLength(0);
    expect(listed.totalCount).toBe(0);
  });

  it("prod+GCS: skips ingest and upload until hydrate, then keeps GCS history", async () => {
    vi.useFakeTimers();
    const contentRoot = root();
    _setRuntimeIssuesProductionForTests(true);
    vi.spyOn(gcs, "available", "get").mockReturnValue(true);

    const prodFp = "prod-fp";
    const prodState = {
      version: 1 as const,
      updatedAt: Date.UTC(2026, 7, 1),
      issues: {
        [prodFp]: {
          fingerprint: prodFp,
          kind: "http.not_found" as const,
          path: "/prod-history",
          locale: "en",
          count: 9,
          firstSeen: Date.UTC(2026, 7, 1),
          lastSeen: Date.UTC(2026, 7, 14),
        },
      },
      recent: [],
    };
    const download = vi.spyOn(gcs, "downloadFirstExisting").mockResolvedValue({
      key: "site_test/sync/runtime-issues-state.json",
      data: Buffer.from(JSON.stringify(prodState), "utf-8"),
    });
    const upload = vi.spyOn(gcs, "upload").mockResolvedValue(undefined as never);
    const debounced = vi.spyOn(gcs, "debouncedUpload");

    // Early traffic on empty disk must not invent authority or push to GCS.
    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/early-miss",
        userAgent: CHROME,
      }),
    ).toBe(false);
    expect(upload).not.toHaveBeenCalled();
    expect(debounced).not.toHaveBeenCalled();
    expect(listRuntimeIssues("site_test", { contentRoot }).issues).toHaveLength(0);

    await loadRuntimeIssuesForSite("site_test", contentRoot);
    expect(download).toHaveBeenCalled();
    expect(listRuntimeIssues("site_test", { contentRoot }).issues.map((i) => i.path)).toEqual([
      "/prod-history",
    ]);

    expect(
      recordPublicNotFound({
        site: "site_test",
        contentRoot,
        path: "/after-hydrate",
        userAgent: CHROME,
      }),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(upload).toHaveBeenCalled();
    const lastUpload = upload.mock.calls[upload.mock.calls.length - 1];
    const uploaded = JSON.parse((lastUpload[1] as Buffer).toString("utf-8"));
    expect(Object.keys(uploaded.issues).length).toBe(2);
    expect(Object.values(uploaded.issues).map((i: { path: string }) => i.path).sort()).toEqual([
      "/after-hydrate",
      "/prod-history",
    ]);
    expect(debounced).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});
