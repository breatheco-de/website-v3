import { describe, expect, it } from "vitest";
import { formatProposalMarkdown, splitInlineNumberedList } from "./proposal-markdown";

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
