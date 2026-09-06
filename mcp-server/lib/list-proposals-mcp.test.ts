import { describe, it, expect } from "vitest";
import {
  clampProposalLimit,
  clampProposalOffset,
  isProposalsScoped,
  proposalNextOffset,
} from "./list-proposals-mcp";

describe("list-proposals-mcp", () => {
  it("treats status or kind alone as scoped", () => {
    expect(isProposalsScoped({})).toBe(false);
    expect(isProposalsScoped({ limit: 20 })).toBe(false);
    expect(isProposalsScoped({ status: "open" })).toBe(true);
    expect(isProposalsScoped({ kind: "notes" })).toBe(true);
    expect(isProposalsScoped({ query: "cta" })).toBe(true);
  });

  it("clamps limit and computes next_offset", () => {
    expect(clampProposalLimit(undefined)).toBe(20);
    expect(clampProposalLimit(500)).toBe(200);
    expect(clampProposalOffset(-3)).toBe(0);
    expect(proposalNextOffset(0, 20, 50, 20)).toBe(20);
    expect(proposalNextOffset(40, 20, 50, 10)).toBe(null);
  });
});
