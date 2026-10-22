import { describe, expect, it } from "vitest";
import { stuckVersioningFiles } from "./sync-state";

const track = () => true;

describe("stuckVersioningFiles", () => {
  it("picks recorded local versioning.yml edits GitHub does not have, including never-pushed files", () => {
    const files = {
      "site_x/landings/a/versioning.yml": { sha: "local", remoteSha: "remote", lastModified: 1 },
      "site_x/landings/new/versioning.yml": { sha: "new", lastModified: 1 },
      "site_x/landings/clean/versioning.yml": { sha: "same", remoteSha: "same", lastModified: 1 },
      "site_x/landings/a/draft.en.yml": { sha: "local", remoteSha: "remote", lastModified: 1 },
    };
    const disk: Record<string, string> = {
      "site_x/landings/a/versioning.yml": "local",
      "site_x/landings/new/versioning.yml": "new",
      "site_x/landings/clean/versioning.yml": "same",
      "site_x/landings/a/draft.en.yml": "local",
    };
    expect(stuckVersioningFiles(files, { shouldTrack: track, diskSha: (f) => disk[f] ?? null })).toEqual([
      "site_x/landings/a/versioning.yml",
      "site_x/landings/new/versioning.yml",
    ]);
  });

  it("skips files whose disk no longer matches the recorded edit (stale deploy snapshot) or are missing", () => {
    const files = {
      "site_x/landings/a/versioning.yml": { sha: "recorded", remoteSha: "remote", lastModified: 1 },
      "site_x/landings/gone/versioning.yml": { sha: "recorded", remoteSha: "remote", lastModified: 1 },
    };
    const disk: Record<string, string | null> = {
      "site_x/landings/a/versioning.yml": "snapshot",
      "site_x/landings/gone/versioning.yml": null,
    };
    expect(stuckVersioningFiles(files, { shouldTrack: track, diskSha: (f) => disk[f] ?? null })).toEqual([]);
  });
});
