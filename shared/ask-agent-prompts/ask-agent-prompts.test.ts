import { beforeAll, describe, expect, it } from "vitest";
import {
  ASK_AGENT_PROMPT_IDS,
  interpolateAskAgentBody,
  parseAskAgentPromptMarkdown,
  renderAskAgentPrompt,
  setAskAgentPromptSource,
  type AskAgentPromptId,
} from "./index";
import { loadAllAskAgentPromptsFromDisk } from "./load";

const FIXTURES: Record<AskAgentPromptId, Record<string, string>> = {
  "organic-page2": {
    query: "coding bootcamp",
    url: "/en/location/berlin-germany",
    position: "11.5",
    impressions: "150",
    window_label: "7d",
    mcp_url: "http://localhost:5000/mcp",
  },
  "organic-low-ctr": {
    query: "ai software engineering",
    url: "/en/blog/example",
    position: "3.2",
    impressions: "2000",
    ctr: "1.2%",
    expected_ctr: "4.0%",
    window_label: "7d",
    mcp_url: "http://localhost:5000/mcp",
  },
  "organic-missing-serp": {
    query: "what is a coding bootcamp",
    url: "/en/blog/example",
    position: "2.1",
    impressions: "800",
    serp_status: "snippet · not owning feature",
    window_label: "7d",
    mcp_url: "http://localhost:5000/mcp",
  },
  "organic-link-gaps": {
    url: "/en/location/berlin-germany",
    position: "8.0",
    impressions: "400",
    inbound: "1",
    window_label: "7d",
    mcp_url: "http://localhost:5000/mcp",
  },
  "page-diagnostics": {
    url: "/en/blog/example",
    content_type: "blog",
    slug: "example",
    locale: "en",
    variant_line: "",
    file_path: "site_x/blog/example/en.yml",
    mcp_url: "http://localhost:5000/mcp",
    error_block: "- META_MISSING [id=abc]: missing description",
    warning_block: "- (none)",
  },
  "draft-feedback": {
    share_url: "https://example.com/en/blog/example?force_variant=draft1",
    content_type: "blog",
    slug: "example",
    locale: "en",
    variant: "draft1",
    mcp_url: "http://localhost:5000/mcp",
  },
};

describe("ask-agent-prompts", () => {
  beforeAll(() => {
    setAskAgentPromptSource(loadAllAskAgentPromptsFromDisk());
  });

  it("parses every registry template from disk", () => {
    const all = loadAllAskAgentPromptsFromDisk();
    expect(all.size).toBe(ASK_AGENT_PROMPT_IDS.length);
  });

  for (const id of ASK_AGENT_PROMPT_IDS) {
    describe(id, () => {
      it("has complete frontmatter and required sections", () => {
        const tpl = loadAllAskAgentPromptsFromDisk().get(id)!;
        expect(tpl.frontmatter.id).toBe(id);
        expect(tpl.frontmatter.used_when.length).toBeGreaterThan(10);
        expect(tpl.frontmatter.intention.length).toBeGreaterThan(10);
        expect(tpl.frontmatter.success_looks_like.length).toBeGreaterThan(10);
        expect(tpl.frontmatter.failure_modes.length).toBeGreaterThan(0);
        for (const section of tpl.frontmatter.sections) {
          expect(tpl.body).toContain(`${section}:`);
        }
        for (const key of tpl.frontmatter.required) {
          expect(tpl.body).toContain(`{{${key}}}`);
        }
      });

      it("renders fixture under max_chars with no leftovers", () => {
        const tpl = loadAllAskAgentPromptsFromDisk().get(id)!;
        const out = renderAskAgentPrompt(id, FIXTURES[id]);
        expect(out).not.toMatch(/\{\{[a-zA-Z0-9_]+\}\}/);
        expect(out.length).toBeLessThanOrEqual(tpl.frontmatter.max_chars);
        expect(out).toContain("Goal:");
      });
    });
  }

  it("throws on missing required var", () => {
    expect(() =>
      interpolateAskAgentBody("Hi {{query}}", {}, ["query"]),
    ).toThrow(/missing required var/);
  });

  it("rejects body without frontmatter", () => {
    expect(() => parseAskAgentPromptMarkdown("Goal: x\n")).toThrow(/frontmatter/);
  });
});
