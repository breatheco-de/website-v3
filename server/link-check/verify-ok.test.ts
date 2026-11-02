import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const runValidators = vi.fn();
const files = [
  { type: "blog", slug: "a", locale: "es", filePath: "a/es.yml", title: "A" },
  { type: "blog", slug: "b", locale: "es", filePath: "b/es.yml", title: "B" },
  { type: "blog", slug: "c", locale: "es", filePath: "c/es.yml", title: "C" },
];

vi.mock("../../scripts/validation/service", () => ({
  ValidationService: class {
    private context = { contentFiles: [...files] };
    async buildContext() {}
    getContext() {
      return this.context;
    }
    async runValidators(opts: unknown) {
      runValidators(opts, this.context.contentFiles.map((f) => f.slug));
      return { validators: [{ name: "external-links", errors: [], warnings: [] }] };
    }
  },
}));

import { markExternalLinkOk, unmarkExternalLinkOk } from "./verify-ok";
import { loadLinkStatus } from "./status-store";
import { _resetLinkIndexStateForTests, rebuildLinkIndex } from "../link-index";

const URL = "https://dead.example/x";
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  runValidators.mockReset();
});

function fakeCache() {
  let issues = [
    { id: "i1", code: "EXTERNAL_LINK_GONE", externalLink: { url: URL }, targets: [{ type: "entry", entryKey: "blog/a/es" }] },
    { id: "i2", code: "EXTERNAL_LINK_GONE", externalLink: { url: "https://other/y" }, targets: [] },
  ];
  return {
    getAllIssues: () => issues,
    applyValidatorResults: vi.fn((_v: unknown, opts: { entryKeys: string[] }) => {
      issues = issues.filter((i) => !(i.externalLink.url === URL && opts.entryKeys.includes("blog/a/es")));
    }),
    flush: vi.fn(async () => {}),
  };
}

describe("markExternalLinkOk", () => {
  it("saves the mark, re-runs external-links only for pages using the URL, and reports cleared issues", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-ok-"));
    dirs.push(root);
    _resetLinkIndexStateForTests();
    rebuildLinkIndex({}, root, { "blog/b/es": [URL], "blog/c/es": ["https://other/y"] });
    const cache = fakeCache();

    const out = await markExternalLinkOk({
      cache: cache as never,
      ci: {} as never,
      contentRoot: root,
      url: URL,
      by: "staff@x.com",
      reason: "Opened it, shows the report",
    });

    expect(out.entry_keys).toEqual(["blog/a/es", "blog/b/es"]);
    expect(out.cleared_issue_ids).toEqual(["i1"]);
    expect(runValidators).toHaveBeenCalledWith({ validators: ["external-links"], includeArtifacts: false }, ["a", "b"]);
    expect(loadLinkStatus(root).urls[URL]?.verified_ok).toMatchObject({ by: "staff@x.com" });

    const undo = await unmarkExternalLinkOk({ cache: cache as never, ci: {} as never, contentRoot: root, url: URL });
    expect(undo.removed).toBe(true);
    expect(loadLinkStatus(root).urls[URL]?.verified_ok).toBeUndefined();
  });
});
