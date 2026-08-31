import { describe, expect, it } from "vitest";
import { extractCompletionText } from "./LLMService";

describe("extractCompletionText", () => {
  it("returns trimmed string content", () => {
    expect(extractCompletionText({ content: "  hello  " })).toBe("hello");
  });

  it("joins text parts from content arrays", () => {
    expect(
      extractCompletionText({
        content: [
          { type: "text", text: "Line one." },
          { type: "text", text: "Line two." },
        ],
      }),
    ).toBe("Line one.\nLine two.");
  });

  it("returns null for empty content", () => {
    expect(extractCompletionText({ content: "   " })).toBeNull();
    expect(extractCompletionText({ content: [] })).toBeNull();
    expect(extractCompletionText(null)).toBeNull();
  });

  it("throws on model refusal", () => {
    expect(() =>
      extractCompletionText({ content: null, refusal: "Policy violation" }),
    ).toThrow("LLM refused: Policy violation");
  });
});
