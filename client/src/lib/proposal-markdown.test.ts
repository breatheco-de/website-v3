import { describe, expect, it } from "vitest";
import type { Root } from "mdast";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import {
  formatProposalMarkdown,
  isSitePath,
  remarkSitePaths,
  splitInlineNumberedList,
  splitSitePaths,
} from "./proposal-markdown";

describe("splitInlineNumberedList", () => {
  it("turns inline (1) (2) markers into a numbered list under the lead sentence", () => {
    const body =
      "The idea is sound, but the asset has two problems. (1) Wrong file is linked. (2) The PDF is in English only.";
    expect(splitInlineNumberedList(body)).toBe(
      "The idea is sound, but the asset has two problems.\n\n1. Wrong file is linked.\n2. The PDF is in English only.",
    );
  });

  it("handles text that starts with (1)", () => {
    expect(splitInlineNumberedList("(1) X is wrong. (2) Fix is Y. (3) Matters because Z.")).toBe(
      "1. X is wrong.\n2. Fix is Y.\n3. Matters because Z.",
    );
  });

  it("leaves text that already uses a Markdown list unchanged", () => {
    const body = "Verdict.\n\n1. First (see (1) above)\n2. Second";
    expect(splitInlineNumberedList(body)).toBe(body);
  });

  it("leaves a single marker or a non-sequential set unchanged", () => {
    expect(splitInlineNumberedList("Only one point (1) here.")).toBe("Only one point (1) here.");
    expect(splitInlineNumberedList("Figures (2) and (5) differ.")).toBe("Figures (2) and (5) differ.");
  });

  it("does not treat years in parentheses as markers", () => {
    const body = "Salary data (2026) is stale versus the source (2025).";
    expect(splitInlineNumberedList(body)).toBe(body);
  });
});

describe("formatProposalMarkdown", () => {
  it("keeps single line breaks as Markdown hard breaks", () => {
    expect(formatProposalMarkdown("Goal: leads.\nEvidence: uploads.")).toBe("Goal: leads.  \nEvidence: uploads.");
  });

  it("leaves paragraph breaks alone", () => {
    expect(formatProposalMarkdown("Verdict.\n\nDetails.")).toBe("Verdict.\n\nDetails.");
  });

  it("trims and splits inline lists before adding breaks", () => {
    expect(formatProposalMarkdown("  Lead. (1) A. (2) B.  ")).toBe("Lead.\n\n1. A.  \n2. B.");
  });
});

describe("splitSitePaths", () => {
  it("pulls a site path out of prose without trailing punctuation", () => {
    expect(splitSitePaths("the address /blog/ai-tools/grok-bot-use-cases still returns 404.")).toEqual([
      { kind: "text", value: "the address " },
      { kind: "path", value: "/blog/ai-tools/grok-bot-use-cases" },
      { kind: "text", value: " still returns 404." },
    ]);
    expect(splitSitePaths("(see /en/blog/x).")).toEqual([
      { kind: "text", value: "(see " },
      { kind: "path", value: "/en/blog/x" },
      { kind: "text", value: ")." },
    ]);
  });

  it("ignores slashes inside words, dates and full URLs", () => {
    for (const text of ["EN/ES copy", "and/or", "2026/10/22", "https://4geeks.com/blog/x", "site_4geeks-com/blog/x.yml"]) {
      expect(splitSitePaths(text)).toEqual([{ kind: "text", value: text }]);
    }
  });
});

describe("isSitePath", () => {
  it("accepts site-relative paths only", () => {
    expect(isSitePath("/blog/x")).toBe(true);
    expect(isSitePath("/es/cursos?ref=a")).toBe(true);
    expect(isSitePath("//cdn.example.com/x")).toBe(false);
    expect(isSitePath("https://4geeks.com/x")).toBe(false);
    expect(isSitePath("/")).toBe(false);
  });
});

describe("remarkSitePaths", () => {
  const linkUrls = (md: string) => {
    const processor = unified().use(remarkParse).use(remarkGfm).use(remarkSitePaths);
    const tree = processor.runSync(processor.parse(md)) as Root;
    const urls: string[] = [];
    const walk = (node: { type: string; url?: string; children?: unknown[] }) => {
      if (node.type === "link" && node.url) urls.push(node.url);
      (node.children as (typeof node)[] | undefined)?.forEach(walk);
    };
    walk(tree);
    return urls;
  };

  it("links bare paths and inline-code paths, leaving existing links alone", () => {
    expect(linkUrls("Bare /blog/a, code `/blog/b`, link [/blog/c](/blog/c), file `server/x.ts`.")).toEqual([
      "/blog/a",
      "/blog/b",
      "/blog/c",
    ]);
  });
});
