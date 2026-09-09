import { describe, expect, it, vi } from "vitest";
import type { FileCommitEntry } from "./github";
import {
  countSectionDiffStats,
  formatSectionHistoryCursor,
  listSectionHistory,
  parseSectionHistoryCursor,
  sectionFingerprintFromYaml,
} from "./github-graphql";

function commit(sha: string, n: number, parentSha?: string | null): FileCommitEntry {
  return {
    sha,
    date: `2026-09-0${Math.min(9, n)}T12:00:00Z`,
    author: "Tester",
    subject: `commit ${sha}`,
    parentSha: parentSha ?? null,
  };
}

function yamlWithSections(sections: Array<Record<string, unknown>>): string {
  const body = sections
    .map((s) => {
      const id = s.section_id ? `  - section_id: ${s.section_id}\n` : "  -\n";
      const title = typeof s.title === "string" ? `    title: ${JSON.stringify(s.title)}\n` : "";
      const type = typeof s.type === "string" ? `    type: ${s.type}\n` : "";
      return `${id}${type}${title}`;
    })
    .join("");
  return `sections:\n${body}`;
}

describe("section history cursor", () => {
  it("parses and formats pN-iM", () => {
    expect(parseSectionHistoryCursor(undefined)).toEqual({ page: 1, index: 0 });
    expect(parseSectionHistoryCursor("p2-i5")).toEqual({ page: 2, index: 5 });
    expect(formatSectionHistoryCursor(3, 4)).toBe("p3-i4");
  });
});

describe("sectionFingerprintFromYaml", () => {
  it("matches by section_id preferentially", () => {
    const text = yamlWithSections([
      { section_id: "a", title: "A" },
      { section_id: "b", title: "B" },
    ]);
    const fp = sectionFingerprintFromYaml(text, { sectionId: "b", sectionIndex: 0 });
    expect(fp).toContain('"section_id":"b"');
    expect(fp).toContain('"title":"B"');
  });

  it("falls back to index when id missing", () => {
    const text = yamlWithSections([{ title: "only" }]);
    const fp = sectionFingerprintFromYaml(text, { sectionId: null, sectionIndex: 0 });
    expect(fp).toContain('"title":"only"');
  });

  it("does not fall back to index when sectionId is set but absent", () => {
    const text = yamlWithSections([
      { section_id: "other", title: "Wrong slot" },
      { section_id: "also", title: "Also wrong" },
    ]);
    const fp = sectionFingerprintFromYaml(text, {
      sectionId: "list_press_mentions-w7r1sh",
      sectionIndex: 0,
    });
    expect(fp).toBeUndefined();
  });

  it("parses YAML with liquid defaults that contain %", () => {
    const text = [
      "sections:",
      "  - section_id: hero-tcvppl",
      "    type: hero",
      "    title: Home",
      "    stats:",
      "      - value: {{ global.global_job_placement_rate | 84% }}%",
      "",
    ].join("\n");
    const fp = sectionFingerprintFromYaml(text, { sectionId: "hero-tcvppl", sectionIndex: 0 });
    expect(fp).toBeTruthy();
    expect(fp).toContain("hero-tcvppl");
    expect(fp).toContain("84%");
  });
});

describe("countSectionDiffStats", () => {
  it("counts added and removed lines", () => {
    expect(countSectionDiffStats("a\nb\n", "a\nc\n")).toEqual({ additions: 1, deletions: 1 });
  });

  it("returns zeros when identical", () => {
    expect(countSectionDiffStats("x\n", "x\n")).toEqual({ additions: 0, deletions: 0 });
  });
});

describe("listSectionHistory", () => {
  it("keeps only commits where the section differs from the git parent", async () => {
    // Newest first. aaa same as parent bbb → skip; bbb differs from ccc → keep; ccc is root intro → keep
    const commits = [
      commit("aaa1111", 3, "bbb2222"),
      commit("bbb2222", 2, "ccc3333"),
      commit("ccc3333", 1, null),
    ];
    const blobs: Record<string, string> = {
      aaa1111: yamlWithSections([{ section_id: "hero", title: "New" }]),
      bbb2222: yamlWithSections([{ section_id: "hero", title: "New" }]),
      ccc3333: yamlWithSections([{ section_id: "hero", title: "Old" }]),
    };

    const listCommitsFn = vi.fn(async () => ({
      success: true as const,
      entries: commits,
      repoUrl: "https://github.com/org/repo",
    }));
    const fetchBlobsFn = vi.fn(async (opts: { shas: string[] }) => {
      const out: Record<string, string> = {};
      for (const s of opts.shas) if (blobs[s]) out[s] = blobs[s]!;
      return { success: true as const, blobs: out, skipped: 0, repoUrl: "https://github.com/org/repo" };
    });

    const result = await listSectionHistory({
      filePath: "site_test/pages/x/en.yml",
      sectionId: "hero",
      sectionIndex: 0,
      limit: 10,
      maxBatches: 3,
      listCommitsFn: listCommitsFn as any,
      fetchBlobsFn: fetchBlobsFn as any,
    });

    expect(result.success).toBe(true);
    expect(result.entries.map((e) => e.sha)).toEqual(["bbb2222", "ccc3333"]);
    expect(result.entries[0]?.additions).toBeGreaterThan(0);
    expect(result.entries[0]?.deletions).toBeGreaterThan(0);
    expect(result.hasMore).toBe(false);
  });

  it("treats missing parent blob as section introduction (file add)", async () => {
    const commits = [
      commit("aaa1111", 2, "missingparent"),
      commit("bbb2222", 1, null),
    ];
    const listCommitsFn = vi.fn(async () => ({
      success: true as const,
      entries: commits,
      repoUrl: "https://github.com/org/repo",
    }));
    const fetchBlobsFn = vi.fn(async () => ({
      success: true as const,
      blobs: {
        aaa1111: yamlWithSections([{ section_id: "hero", title: "A" }]),
        bbb2222: yamlWithSections([{ section_id: "hero", title: "Only" }]),
      },
      skipped: 1,
      repoUrl: "https://github.com/org/repo",
    }));

    const result = await listSectionHistory({
      filePath: "site_test/pages/x/en.yml",
      sectionId: "hero",
      sectionIndex: 0,
      listCommitsFn: listCommitsFn as any,
      fetchBlobsFn: fetchBlobsFn as any,
    });

    expect(result.success).toBe(true);
    expect(result.skipped).toBe(1);
    // aaa: parent blob missing → introduction (kept); bbb: root intro kept
    expect(result.entries.map((e) => e.sha)).toEqual(["aaa1111", "bbb2222"]);
    expect(result.entries[0]?.additions).toBeGreaterThan(0);
    expect(result.entries[0]?.deletions).toBe(0);
  });

  it("does not list a commit that only changed other sections (same as parent)", async () => {
    const commits = [commit("touchother", 1, "parent000")];
    const same = yamlWithSections([
      { section_id: "hero", title: "Same" },
      { section_id: "other", title: "Changed elsewhere" },
    ]);
    const listCommitsFn = vi.fn(async () => ({
      success: true as const,
      entries: commits,
      repoUrl: "https://github.com/org/repo",
    }));
    const fetchBlobsFn = vi.fn(async () => ({
      success: true as const,
      blobs: {
        touchother: same,
        parent000: same,
      },
      skipped: 0,
    }));

    const result = await listSectionHistory({
      filePath: "site_test/pages/x/en.yml",
      sectionId: "hero",
      sectionIndex: 0,
      listCommitsFn: listCommitsFn as any,
      fetchBlobsFn: fetchBlobsFn as any,
    });

    expect(result.entries).toHaveLength(0);
  });

  it("stops auto-continue at maxBatches and sets hasMore cursor", async () => {
    const page1 = Array.from({ length: 25 }, (_, i) =>
      commit(`a${String(i).padStart(6, "0")}`, 1, `p${String(i).padStart(6, "0")}`),
    );
    const page2 = Array.from({ length: 25 }, (_, i) =>
      commit(`b${String(i).padStart(6, "0")}`, 1, `q${String(i).padStart(6, "0")}`),
    );
    const page3 = Array.from({ length: 25 }, (_, i) =>
      commit(`c${String(i).padStart(6, "0")}`, 1, `r${String(i).padStart(6, "0")}`),
    );
    const pages: FileCommitEntry[][] = [page1, page2, page3];

    // Same section at head and parent → zero filtered hits, but still exhaust 3 batches
    const sameYaml = yamlWithSections([{ section_id: "hero", title: "Same" }]);

    const listCommitsFn = vi.fn(async (_path: string, opts?: { page?: number; limit?: number }) => {
      const page = opts?.page ?? 1;
      const entries = pages[page - 1] ?? [];
      return { success: true as const, entries, repoUrl: "https://github.com/org/repo" };
    });

    const fetchBlobsFn = vi.fn(async (opts: { shas: string[] }) => {
      const blobs: Record<string, string> = {};
      for (const sha of opts.shas) blobs[sha] = sameYaml;
      return { success: true as const, blobs, skipped: 0, repoUrl: "https://github.com/org/repo" };
    });

    const result = await listSectionHistory({
      filePath: "site_test/pages/x/en.yml",
      sectionId: "hero",
      sectionIndex: 0,
      limit: 10,
      maxBatches: 3,
      listCommitsFn: listCommitsFn as any,
      fetchBlobsFn: fetchBlobsFn as any,
    });

    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(0);
    expect(result.hasMore).toBe(true);
    expect(result.nextCursor).toBe("p4-i0");
    expect(listCommitsFn.mock.calls.length).toBe(3);
  });

  it("second page via cursor does not duplicate SHAs", async () => {
    const commits = [
      commit("aaa1111", 4, "bbb2222"),
      commit("bbb2222", 3, "ccc3333"),
      commit("ccc3333", 2, "ddd4444"),
      commit("ddd4444", 1, null),
    ];
    const blobs: Record<string, string> = {
      aaa1111: yamlWithSections([{ section_id: "hero", title: "4" }]),
      bbb2222: yamlWithSections([{ section_id: "hero", title: "3" }]),
      ccc3333: yamlWithSections([{ section_id: "hero", title: "2" }]),
      ddd4444: yamlWithSections([{ section_id: "hero", title: "1" }]),
    };

    const listCommitsFn = vi.fn(async () => ({
      success: true as const,
      entries: commits,
      repoUrl: "https://github.com/org/repo",
    }));
    const fetchBlobsFn = vi.fn(async (opts: { shas: string[] }) => {
      const out: Record<string, string> = {};
      for (const s of opts.shas) if (blobs[s]) out[s] = blobs[s]!;
      return { success: true as const, blobs: out, skipped: 0 };
    });

    const first = await listSectionHistory({
      filePath: "site_test/pages/x/en.yml",
      sectionId: "hero",
      sectionIndex: 0,
      limit: 2,
      listCommitsFn: listCommitsFn as any,
      fetchBlobsFn: fetchBlobsFn as any,
    });
    expect(first.entries.map((e) => e.sha)).toEqual(["aaa1111", "bbb2222"]);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe("p1-i2");

    const second = await listSectionHistory({
      filePath: "site_test/pages/x/en.yml",
      sectionId: "hero",
      sectionIndex: 0,
      limit: 2,
      cursor: first.nextCursor,
      listCommitsFn: listCommitsFn as any,
      fetchBlobsFn: fetchBlobsFn as any,
    });
    expect(second.entries.map((e) => e.sha)).toEqual(["ccc3333", "ddd4444"]);
    const overlap = first.entries.filter((e) => second.entries.some((s) => s.sha === e.sha));
    expect(overlap).toHaveLength(0);
  });
});
