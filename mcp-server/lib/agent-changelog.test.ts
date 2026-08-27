import { describe, expect, it } from "vitest";
import {
  filterChangelogEntries,
  buildAgentChangelogPayload,
  type AgentChangelogEntry,
} from "./agent-changelog.js";
import path from "path";
import fs from "fs";
import os from "os";

describe("filterChangelogEntries", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");

  it("keeps entries within the window", () => {
    const entries: AgentChangelogEntry[] = [
      { date: "2026-08-27", summary: "today" },
      { date: "2026-08-22", summary: "5 days ago" },
      { date: "2026-08-20", summary: "7 days ago" },
    ];
    const filtered = filterChangelogEntries(entries, now, 6);
    expect(filtered.map((e) => e.summary)).toEqual(["today", "5 days ago"]);
  });

  it("sorts newest first", () => {
    const entries: AgentChangelogEntry[] = [
      { date: "2026-08-22", summary: "older" },
      { date: "2026-08-26", summary: "newer" },
    ];
    expect(filterChangelogEntries(entries, now, 6).map((e) => e.summary)).toEqual([
      "newer",
      "older",
    ]);
  });
});

describe("buildAgentChangelogPayload", () => {
  it("loads seeded file and includes refresh recommendation", () => {
    const tmp = path.join(os.tmpdir(), `agent-changelog-${Date.now()}.yml`);
    fs.writeFileSync(
      tmp,
      `window_days: 6\nentries:\n  - date: "2099-01-01"\n    summary: "future"\n    tools_changed: true\n`,
      "utf-8",
    );
    const payload = buildAgentChangelogPayload(new Date("2099-01-02T00:00:00.000Z"), tmp);
    expect(payload.entries).toHaveLength(1);
    expect(payload.tool_list_refresh_recommendation).toMatch(/refresh\/reconnect/i);
    expect(payload.session_guidance.some((s) => /refresh/i.test(s))).toBe(true);
    fs.unlinkSync(tmp);
  });
});
