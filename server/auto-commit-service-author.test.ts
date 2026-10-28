import { describe, expect, it } from "vitest";
import { isServiceCommitAuthor } from "./auto-commit";

describe("isServiceCommitAuthor", () => {
  it("treats non-person authors as the service account, in any case", () => {
    for (const a of [undefined, null, "", "System", "system", "SYSTEM", "Unknown", "unknown", "github-pull", "agent", "api", "ads-sync", "migration:006"]) {
      expect(isServiceCommitAuthor(a), String(a)).toBe(true);
    }
  });

  it("keeps people as people (they need GitHub Connect in production)", () => {
    for (const a of ["alice", "Anik4geeks", "aalejo@gmail.com", "systems-team"]) {
      expect(isServiceCommitAuthor(a), a).toBe(false);
    }
  });
});
