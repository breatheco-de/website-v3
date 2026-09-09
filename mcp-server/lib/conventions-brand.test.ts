import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { setMcpSiteConfigsForTest } from "./content.js";
import {
  readBrandTitleFromVariables,
  renderConventionsMarkdown,
  resolveConventionsBranding,
} from "./conventions-brand.js";
import { buildBootstrapPayload } from "./agent-changelog.js";
import { CONVENTIONS_VERSION, resolveSkillVersion } from "./mcp-playbook.js";

afterEach(() => {
  setMcpSiteConfigsForTest(null);
});

describe("renderConventionsMarkdown", () => {
  const tpl = "Brand {{BRAND_TITLE}} at https://{{SITE_DOMAIN}}/en/x";

  it("branded substitutes title and domain", () => {
    expect(
      renderConventionsMarkdown(tpl, {
        mode: "branded",
        brandTitle: "Acme",
        siteDomain: "acme.example",
      }),
    ).toBe("Brand Acme at https://acme.example/en/x");
  });

  it("generic uses instructional placeholders (no raw tokens)", () => {
    const out = renderConventionsMarkdown(tpl, { mode: "generic" });
    expect(out).toBe("Brand this site at https://{site}/en/x");
    expect(out).not.toContain("{{");
  });
});

describe("readBrandTitleFromVariables", () => {
  it("reads brand.title.default", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-brand-"));
    fs.writeFileSync(
      path.join(dir, "variables.yml"),
      "brand.title:\n  default: \"Demo Brand\"\n",
      "utf-8",
    );
    expect(readBrandTitleFromVariables(dir)).toBe("Demo Brand");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-brand-miss-"));
    expect(readBrandTitleFromVariables(dir)).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("resolveConventionsBranding", () => {
  it("multi-site without site → generic", () => {
    setMcpSiteConfigsForTest([
      { domain: "a.example", contentFolder: "site_a" },
      { domain: "b.example", contentFolder: "site_b" },
    ]);
    const r = resolveConventionsBranding();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.branding.mode).toBe("generic");
    expect(r.branding.site).toBeUndefined();
  });

  it("multi-site with site → branded (falls back to domain when no variables)", () => {
    setMcpSiteConfigsForTest([
      { domain: "a.example", contentFolder: "site_a" },
      { domain: "b.example", contentFolder: "site_b" },
    ]);
    const r = resolveConventionsBranding("b.example");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.branding.mode).toBe("branded");
    expect(r.branding.site).toBe("b.example");
    expect(r.branding.brand_title).toBe("b.example");
  });

  it("unknown site → ok false", () => {
    setMcpSiteConfigsForTest([
      { domain: "a.example", contentFolder: "site_a" },
      { domain: "b.example", contentFolder: "site_b" },
    ]);
    const r = resolveConventionsBranding("nope.example");
    expect(r.ok).toBe(false);
  });

  it("sole site → branded", () => {
    const contentFolder = `_tmp_conv_brand_${Date.now()}`;
    const contentPath = path.join(process.cwd(), contentFolder);
    fs.mkdirSync(contentPath, { recursive: true });
    fs.writeFileSync(
      path.join(contentPath, "variables.yml"),
      "brand.title:\n  default: \"Sole Co\"\n",
      "utf-8",
    );
    try {
      setMcpSiteConfigsForTest([{ domain: "sole.example", contentFolder }]);
      const r = resolveConventionsBranding();
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.branding).toEqual({
        mode: "branded",
        site: "sole.example",
        brand_title: "Sole Co",
      });
    } finally {
      fs.rmSync(contentPath, { recursive: true, force: true });
    }
  });
});

describe("buildBootstrapPayload branding", () => {
  it("generic multi-site skill.content has no raw tokens and instructional domain", () => {
    setMcpSiteConfigsForTest([
      { domain: "a.example", contentFolder: "site_a" },
      { domain: "b.example", contentFolder: "site_b" },
    ]);
    const result = buildBootstrapPayload({ cwd: process.cwd() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { payload } = result;
    expect(payload.skill.branding.mode).toBe("generic");
    expect(payload.skill.content).toBeDefined();
    expect(payload.skill.content).not.toContain("{{");
    expect(payload.skill.content).toMatch(/https:\/\/\{site\}\//);
    expect(payload.skill.content).toMatch(/this site/);
    expect(payload.skill.content).not.toMatch(/4Geeks\.com Website MCP/);
    expect(payload.skill.content).not.toMatch(/Alejandro/);
    expect(payload.skill.version).toMatch(new RegExp(`^${CONVENTIONS_VERSION}\\+`));
    expect(payload.skill.version).toBe(resolveSkillVersion(payload.skill.content!));
    expect(payload.session_guidance.some((s) => /pass site on bootstrap_agent/i.test(s))).toBe(
      true,
    );
  });

  it("passed site brands content and version differs from generic", () => {
    setMcpSiteConfigsForTest([
      { domain: "a.example", contentFolder: "site_a" },
      { domain: "b.example", contentFolder: "site_b" },
    ]);
    const generic = buildBootstrapPayload({ cwd: process.cwd() });
    const branded = buildBootstrapPayload({ cwd: process.cwd(), site: "a.example" });
    expect(generic.ok && branded.ok).toBe(true);
    if (!generic.ok || !branded.ok) return;
    expect(branded.payload.skill.branding).toEqual({
      mode: "branded",
      site: "a.example",
      brand_title: "a.example",
    });
    expect(branded.payload.skill.content).toContain("https://a.example/");
    expect(branded.payload.skill.version).not.toBe(generic.payload.skill.version);
  });

  it("unknown site fails", () => {
    setMcpSiteConfigsForTest([
      { domain: "a.example", contentFolder: "site_a" },
      { domain: "b.example", contentFolder: "site_b" },
    ]);
    const result = buildBootstrapPayload({ cwd: process.cwd(), site: "missing.example" });
    expect(result.ok).toBe(false);
  });

  it("known_skill_version still omits content on matching rendered hash", () => {
    setMcpSiteConfigsForTest([
      { domain: "a.example", contentFolder: "site_a" },
      { domain: "b.example", contentFolder: "site_b" },
    ]);
    const first = buildBootstrapPayload({ cwd: process.cwd(), site: "a.example" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = buildBootstrapPayload({
      cwd: process.cwd(),
      site: "a.example",
      known_skill_version: first.payload.skill.version,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.payload.skill.content).toBeUndefined();
    expect(second.payload.skill.version).toBe(first.payload.skill.version);
  });
});
