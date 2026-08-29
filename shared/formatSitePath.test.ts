import { describe, expect, it } from "vitest";
import { formatSitePath, formatSitePathsInText } from "./formatSitePath";

describe("formatSitePath", () => {
  it("strips absolute path under site folder", () => {
    const input = "/Users/me/proj/site_4geeks-florida/pages/about/en.yml";
    expect(formatSitePath(input)).toBe("pages/about/en.yml");
  });

  it("strips cwd-relative path with site folder prefix", () => {
    expect(formatSitePath("site_4geeks-florida/pages/about/en.yml")).toBe("pages/about/en.yml");
  });

  it("leaves already-stripped site paths unchanged", () => {
    expect(formatSitePath("pages/about/en.yml")).toBe("pages/about/en.yml");
  });

  it("uses explicit contentFolder when provided", () => {
    const input = "/Users/me/proj/site_4geeks-florida/pages/about/en.yml";
    expect(
      formatSitePath(input, { contentFolder: "site_4geeks-florida" }),
    ).toBe("pages/about/en.yml");
  });

  it("falls back to filename for /tmp paths", () => {
    expect(formatSitePath("/tmp/validation-reports/report-x.json")).toBe("report-x.json");
  });

  it("strips legacy marketing-content root like other site folders", () => {
    expect(
      formatSitePath("marketing-content/component-registry/hero/v1.0/schema.ts"),
    ).toBe("component-registry/hero/v1.0/schema.ts");
    expect(
      formatSitePath(
        "/home/runner/workspace/marketing-content/programs/ai-engineering/en.yml",
      ),
    ).toBe("programs/ai-engineering/en.yml");
  });

  it("handles Windows backslashes", () => {
    expect(
      formatSitePath("site_4geeks-florida\\pages\\about\\en.yml"),
    ).toBe("pages/about/en.yml");
  });

  it("recognizes legacy 4geeks-com folder", () => {
    expect(formatSitePath("4geeks-com/landings/home/en.yml")).toBe("landings/home/en.yml");
  });

  it("recognizes knownSiteFolders from /api/sites", () => {
    expect(
      formatSitePath("/var/app/custom-folder/pages/en.yml", {
        knownSiteFolders: ["custom-folder"],
      }),
    ).toBe("pages/en.yml");
  });
});

describe("formatSitePathsInText", () => {
  it("rewrites absolute paths in REDIRECT_CONFLICT messages", () => {
    const message =
      'Redirect conflict: "/landing/ai-engineering-program-ad" is claimed by both ' +
      '"/Users/me/proj/site_4geeks-com/landings/xx/es.yml" and ' +
      '"/Users/me/proj/site_4geeks-com/landings/yy/en.yml"';
    expect(formatSitePathsInText(message)).toBe(
      'Redirect conflict: "/landing/ai-engineering-program-ad" is claimed by both ' +
        '"landings/xx/es.yml" and "landings/yy/en.yml"',
    );
  });

  it("keeps sibling locale files distinct for legacy marketing-content paths", () => {
    const message =
      'Redirect conflict: "/bootcamp/ai-engineering" is claimed by both ' +
      '"/home/runner/workspace/marketing-content/programs/ai-engineering-devs/en.yml" and ' +
      '"/home/runner/workspace/marketing-content/programs/ai-engineering/en.yml"';
    expect(formatSitePathsInText(message)).toBe(
      'Redirect conflict: "/bootcamp/ai-engineering" is claimed by both ' +
        '"programs/ai-engineering-devs/en.yml" and ' +
        '"programs/ai-engineering/en.yml"',
    );
  });

  it("preserves (live) suffix on redirect claimant labels", () => {
    const message =
      'Redirect conflict: "/bootcamp/ai" is claimed by both ' +
      '"programs/ai-engineering/en.yml (live)" and ' +
      '"site_4geeks-com/programs/ai-engineering-devs/en.yml (live)"';
    expect(formatSitePathsInText(message)).toBe(
      'Redirect conflict: "/bootcamp/ai" is claimed by both ' +
        '"programs/ai-engineering/en.yml (live)" and ' +
        '"programs/ai-engineering-devs/en.yml (live)"',
    );
  });

  it("leaves URL-only quotes unchanged", () => {
    expect(formatSitePathsInText('Self-redirect detected: "/us/bootcamp" redirects to itself')).toBe(
      'Self-redirect detected: "/us/bootcamp" redirects to itself',
    );
  });

  it("formats a standalone content path", () => {
    expect(
      formatSitePathsInText("/Users/me/proj/site_4geeks-com/landings/xx/es.yml"),
    ).toBe("landings/xx/es.yml");
  });
});
