import { describe, expect, it } from "vitest";
import {
  formatAgentAuthorLabel,
  formatAutoSyncCommitMessage,
  parseAutoSyncCommitAuthor,
  parseCommitAuthorTag,
} from "./git-commit-attribution";

describe("formatAgentAuthorLabel", () => {
  it("prefers model over client for MCP actors", () => {
    expect(
      formatAgentAuthorLabel({
        type: "mcp",
        client: "Cursor",
        model: "claude-4-sonnet",
      }),
    ).toBe("claude");
  });

  it("falls back to client when model is missing", () => {
    expect(formatAgentAuthorLabel({ type: "mcp", client: "Cursor" })).toBe("cursor");
  });

  it("returns undefined for UI actors", () => {
    expect(formatAgentAuthorLabel({ type: "ui" })).toBeUndefined();
  });

  it("maps system agent source", () => {
    expect(formatAgentAuthorLabel({ type: "system", source: "agent" })).toBe("agent");
  });
});

describe("formatAutoSyncCommitMessage", () => {
  it("omits Author prefix for staff UI", () => {
    expect(formatAutoSyncCommitMessage("aalejo@gmail.com", "blog/foo/en.yml")).toBe(
      "[Auto-sync] aalejo@gmail.com updated blog/foo/en.yml",
    );
  });

  it("prefixes agent label for MCP", () => {
    expect(
      formatAutoSyncCommitMessage("aalejo@gmail.com", "blog/foo/en.yml", "claude"),
    ).toBe("[Author: claude] [Auto-sync] aalejo@gmail.com updated blog/foo/en.yml");
  });
});

describe("parseAutoSyncCommitAuthor", () => {
  it("parses legacy auto-sync messages", () => {
    expect(
      parseAutoSyncCommitAuthor("[Auto-sync] aalejo@gmail.com updated blog/foo/en.yml"),
    ).toBe("aalejo@gmail.com");
  });

  it("parses auto-sync after agent Author prefix", () => {
    expect(
      parseAutoSyncCommitAuthor(
        "[Author: claude] [Auto-sync] aalejo@gmail.com updated blog/foo/en.yml",
      ),
    ).toBe("aalejo@gmail.com");
  });
});

describe("parseCommitAuthorTag", () => {
  it("extracts first Author tag", () => {
    expect(
      parseCommitAuthorTag("[Author: claude] [Auto-sync] aalejo@gmail.com updated foo.yml"),
    ).toBe("claude");
  });
});
