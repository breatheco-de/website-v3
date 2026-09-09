import { describe, expect, it } from "vitest";
import { buildDiffRows } from "./text-diff-view";

describe("buildDiffRows", () => {
  it("marks added and removed lines", () => {
    const rows = buildDiffRows("a\nb\n", "a\nc\n");
    expect(rows.filter((r) => r.kind === "removed").map((r) => r.text)).toEqual(["b"]);
    expect(rows.filter((r) => r.kind === "added").map((r) => r.text)).toEqual(["c"]);
    expect(rows.some((r) => r.kind === "context" && r.text === "a")).toBe(true);
  });

  it("returns only context when identical", () => {
    const rows = buildDiffRows("x\n", "x\n");
    expect(rows.every((r) => r.kind === "context")).toBe(true);
  });
});
