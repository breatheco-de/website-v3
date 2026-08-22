import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getDefaultContentPath,
  resolveSiteContext,
  setMcpSiteConfigsForTest,
} from "./content.js";

afterEach(() => {
  setMcpSiteConfigsForTest(null);
});

describe("resolveSiteContext", () => {
  it("multi-site without domain → multi_site_domain_required", () => {
    setMcpSiteConfigsForTest([
      { domain: "4geeks.com", contentFolder: "site_4geeks-com" },
      { domain: "business.4geeks.com", contentFolder: "site_business-4geeks" },
    ]);
    const result = resolveSiteContext();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const parsed = JSON.parse(result.error) as Record<string, unknown>;
    expect(parsed.error).toBe("multi_site_domain_required");
    expect(parsed.requested_site).toBeUndefined();
  });

  it("case-insensitive match succeeds", () => {
    setMcpSiteConfigsForTest([
      { domain: "4geeks.com", contentFolder: "site_4geeks-com" },
      { domain: "business.4geeks.com", contentFolder: "site_business-4geeks" },
    ]);
    const result = resolveSiteContext("Business.4geeks.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe("business.4geeks.com");
    expect(result.contentFolder).toBe("site_business-4geeks");
    expect(result.contentPath).toBe(path.join(process.cwd(), "site_business-4geeks"));
  });

  it("unknown domain includes requested_site", () => {
    setMcpSiteConfigsForTest([
      { domain: "4geeks.com", contentFolder: "site_4geeks-com" },
      { domain: "business.4geeks.com", contentFolder: "site_business-4geeks" },
    ]);
    const result = resolveSiteContext("nope.example");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const parsed = JSON.parse(result.error) as Record<string, unknown>;
    expect(parsed.error).toBe("unknown_site");
    expect(parsed.requested_site).toBe("nope.example");
  });

  it("single-site with wrong site → unknown_site", () => {
    setMcpSiteConfigsForTest([
      { domain: "only.example.com", contentFolder: "site_only" },
    ]);
    const result = resolveSiteContext("other.example.com");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const parsed = JSON.parse(result.error) as Record<string, unknown>;
    expect(parsed.error).toBe("unknown_site");
    expect(parsed.requested_site).toBe("other.example.com");
  });

  it("single-site without site succeeds", () => {
    setMcpSiteConfigsForTest([
      { domain: "only.example.com", contentFolder: "site_only" },
    ]);
    const result = resolveSiteContext();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe("only.example.com");
  });

  it("single-site case-insensitive match succeeds", () => {
    setMcpSiteConfigsForTest([
      { domain: "only.example.com", contentFolder: "site_only" },
    ]);
    const result = resolveSiteContext("Only.Example.com");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.domain).toBe("only.example.com");
  });
});

describe("getDefaultContentPath", () => {
  it("returns sole site folder", () => {
    setMcpSiteConfigsForTest([
      { domain: "only.example.com", contentFolder: "site_only" },
    ]);
    expect(getDefaultContentPath()).toBe(path.join(process.cwd(), "site_only"));
  });

  it("throws when multiple sites are configured", () => {
    setMcpSiteConfigsForTest([
      { domain: "a.com", contentFolder: "site_a" },
      { domain: "b.com", contentFolder: "site_b" },
    ]);
    expect(() => getDefaultContentPath()).toThrow(/Multi-site: content path required/);
  });
});
