import { beforeAll, describe, expect, it } from "vitest";
import {
  ASK_AGENT_PROMPT_FIXTURES,
  ASK_AGENT_PROMPT_IDS,
  interpolateAskAgentBody,
  parseAskAgentPromptMarkdown,
  renderAskAgentPrompt,
  setAskAgentPromptSource,
} from "./index";
import { loadAllAskAgentPromptsFromDisk } from "./load";

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
        expect(tpl.raw).toContain("---");
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
        const out = renderAskAgentPrompt(id, ASK_AGENT_PROMPT_FIXTURES[id]);
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

  it("keeps placeholders that appear inside substituted values", () => {
    const out = interpolateAskAgentBody(
      "Outer:\n{{target_raw}}\n",
      { target_raw: "Inner {{query}} and {{url}}" },
      ["target_raw"],
    );
    expect(out).toContain("Inner {{query}} and {{url}}");
    expect(out).not.toContain("{{target_raw}}");
  });

  it("polish meta prompt can embed a real template body with placeholders", () => {
    const target = loadAllAskAgentPromptsFromDisk().get("organic-page2")!;
    const out = renderAskAgentPrompt("polish-ask-agent-prompt", {
      ...ASK_AGENT_PROMPT_FIXTURES["polish-ask-agent-prompt"],
      target_raw: target.raw.trimEnd(),
    });
    expect(out).toContain("{{query}}");
    expect(out).toContain("{{mcp_url}}");
    expect(out).not.toContain("{{target_raw}}");
    expect(out).not.toContain("{{target_id}}");
  });

  it("still rejects unsubstituted template placeholders", () => {
    expect(() =>
      interpolateAskAgentBody("Hi {{query}} and {{url}}", { query: "x" }, ["query"]),
    ).toThrow(/unsubstituted placeholders: \{\{url\}\}/);
  });

  it("rejects body without frontmatter", () => {
    expect(() => parseAskAgentPromptMarkdown("Goal: x\n")).toThrow(/frontmatter/);
  });
});
