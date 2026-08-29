import { describe, expect, it } from "vitest";
import {
  extractRedirectClaimantPaths,
  keepInFileLabel,
  parseRedirectConflict,
  stripLiveRedirectLabel,
} from "./RedirectConflictResolver";

describe("stripLiveRedirectLabel", () => {
  it("strips (live) suffix", () => {
    expect(stripLiveRedirectLabel("programs/ai/en.yml (live)")).toBe("programs/ai/en.yml");
  });

  it("leaves plain paths unchanged", () => {
    expect(stripLiveRedirectLabel("programs/ai/en.yml")).toBe("programs/ai/en.yml");
  });
});

describe("extractRedirectClaimantPaths", () => {
  it("parses current validator labels with (live) suffix", () => {
    const message =
      'Redirect conflict: "/bootcamp/ai" is claimed by both ' +
      '"programs/ai-engineering/en.yml (live)" and ' +
      '"programs/ai-engineering-devs/en.yml (live)"';
    expect(extractRedirectClaimantPaths(message)).toEqual([
      "programs/ai-engineering/en.yml",
      "programs/ai-engineering-devs/en.yml",
    ]);
  });

  it("parses legacy absolute site_* paths", () => {
    const message =
      'Redirect conflict: "/x" is claimed by both ' +
      '"/Users/me/proj/site_4geeks-com/programs/a/en.yml" and ' +
      '"/Users/me/proj/site_4geeks-com/programs/b/en.yml"';
    expect(extractRedirectClaimantPaths(message)).toEqual([
      "site_4geeks-com/programs/a/en.yml",
      "site_4geeks-com/programs/b/en.yml",
    ]);
  });

  it("parses custom-redirects conflicts-with path", () => {
    const message =
      'Redirect conflict: "/old" in custom-redirects.yml conflicts with ' +
      '"site_4geeks-com/programs/a/en.yml"';
    expect(extractRedirectClaimantPaths(message)).toEqual([
      "site_4geeks-com/programs/a/en.yml",
    ]);
  });

  it("parses legacy absolute marketing-content paths from cache", () => {
    const message =
      'Redirect conflict: "/bootcamp/ai-engineering" is claimed by both ' +
      '"/home/runner/workspace/marketing-content/programs/ai-engineering-devs/en.yml" and ' +
      '"/home/runner/workspace/marketing-content/programs/ai-engineering/en.yml"';
    expect(extractRedirectClaimantPaths(message)).toEqual([
      "marketing-content/programs/ai-engineering-devs/en.yml",
      "marketing-content/programs/ai-engineering/en.yml",
    ]);
    expect(keepInFileLabel(extractRedirectClaimantPaths(message), 0)).toBe(
      "Keep in programs / ai-engineering-devs / en.yml",
    );
    expect(keepInFileLabel(extractRedirectClaimantPaths(message), 1)).toBe(
      "Keep in programs / ai-engineering / en.yml",
    );
  });
});

describe("parseRedirectConflict", () => {
  it("returns both distinct files for current REDIRECT_CONFLICT messages", () => {
    const info = parseRedirectConflict({
      type: "error",
      code: "REDIRECT_CONFLICT",
      message:
        'Redirect conflict: "/bootcamp/ai" is claimed by both ' +
        '"programs/ai-engineering/en.yml (live)" and ' +
        '"programs/ai-engineering-devs/en.yml (live)"',
      file: "site_4geeks-com/programs/ai-engineering/en.yml",
    });
    expect(info?.redirectUrl).toBe("/bootcamp/ai");
    expect(info?.files).toEqual([
      "site_4geeks-com/programs/ai-engineering/en.yml",
      "programs/ai-engineering-devs/en.yml",
    ]);
  });

  it("does not duplicate issue.file when it matches a claimant after normalize", () => {
    const info = parseRedirectConflict({
      type: "error",
      code: "REDIRECT_CONFLICT",
      message:
        'Redirect conflict: "/bootcamp/ai" is claimed by both ' +
        '"site_4geeks-com/programs/ai-engineering/en.yml (live)" and ' +
        '"site_4geeks-com/programs/ai-engineering-devs/en.yml (live)"',
      file: "/Users/me/proj/site_4geeks-com/programs/ai-engineering/en.yml",
    });
    expect(info?.files).toEqual([
      "site_4geeks-com/programs/ai-engineering/en.yml",
      "site_4geeks-com/programs/ai-engineering-devs/en.yml",
    ]);
  });

  it("parses REDIRECT_OVERLAP claimants with (live) labels", () => {
    const info = parseRedirectConflict({
      type: "warning",
      code: "REDIRECT_OVERLAP",
      message:
        'Redirect "/x" exists in both "programs/foo/_common.yml (live)" and "programs/foo/en.yml (live)"',
      file: "site_4geeks-com/programs/foo/en.yml",
    });
    expect(info?.files.map((f) => formatSitePathForTest(f))).toEqual([
      "programs/foo/_common.yml",
      "programs/foo/en.yml",
    ]);
  });
});

function formatSitePathForTest(f: string): string {
  // local import avoided — mirror formatSitePath strip of site folder for assertions
  return f.replace(/^site_[^/]+\//, "").replace(/^4geeks-com\//, "").replace(/^content\//, "");
}

describe("keepInFileLabel", () => {
  it("shows full relative paths so sibling en.yml files stay distinct", () => {
    const files = [
      "programs/ai-engineering/en.yml",
      "programs/ai-engineering-devs/en.yml",
    ];
    expect(keepInFileLabel(files, 0)).toBe("Keep in programs / ai-engineering / en.yml");
    expect(keepInFileLabel(files, 1)).toBe("Keep in programs / ai-engineering-devs / en.yml");
  });

  it("uses ordinals when only bare basenames are available", () => {
    const files = ["en.yml", "en.yml"];
    expect(keepInFileLabel(files, 0)).toBe("Keep in first en.yml");
    expect(keepInFileLabel(files, 1)).toBe("Keep in second en.yml");
  });
});
