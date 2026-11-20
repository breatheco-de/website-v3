import { describe, expect, it } from "vitest";
import {
  buildFunnelClassifySnippet,
  FUNNEL_SNIPPET_MIN_CHARS,
  isFunnelSnippetTooThin,
} from "./funnel-classify-snippet";

describe("buildFunnelClassifySnippet", () => {
  it("returns empty when copy is too thin", () => {
    expect(buildFunnelClassifySnippet({ title: "Hi" })).toBe("");
    expect(isFunnelSnippetTooThin("short")).toBe(true);
  });

  it("joins title, meta, hero, and CTA text", () => {
    const snippet = buildFunnelClassifySnippet({
      title: "From Developer to Certified AI Engineer",
      meta: {
        page_title: "AI Engineering for Developers",
        description: "Move from software engineering into applied AI roles with projects.",
      },
      sections: [
        {
          type: "hero",
          data: {
            title: "Build real AI systems",
            subtitle: "For people who already code",
            button: { text: "Apply now" },
          },
        },
        {
          type: "sticky_cta",
          data: { title: "Ready to start?", button: { label: "Talk to admissions" } },
        },
      ],
    });
    expect(snippet.length).toBeGreaterThanOrEqual(FUNNEL_SNIPPET_MIN_CHARS);
    expect(snippet).toContain("From Developer to Certified AI Engineer");
    expect(snippet).toContain("Build real AI systems");
    expect(snippet).toContain("Talk to admissions");
  });

  it("strips template tokens and urls", () => {
    const snippet = buildFunnelClassifySnippet({
      title: "Learn {{ entry.title }} at https://example.com/path today with enough words here",
      meta: { description: "A longer description so the snippet clears the minimum character gate easily." },
    });
    expect(snippet).not.toContain("{{");
    expect(snippet).not.toContain("https://");
  });
});
