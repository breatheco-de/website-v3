import { describe, expect, it } from "vitest";
import {
  filterChangelogEntries,
  buildAgentChangelogPayload,
  buildBootstrapPayload,
  type AgentChangelogEntry,
} from "./agent-changelog.js";
import {
  CONVENTIONS_VERSION,
  PLAYBOOK_VERSION,
  shouldIncludeSkillContent,
  resolveSkillVersion,
} from "./mcp-playbook.js";
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

describe("shouldIncludeSkillContent", () => {
  it("defaults to include when include_skill_content omitted", () => {
    expect(
      shouldIncludeSkillContent({ skillVersion: "1+abc" }),
    ).toBe(true);
  });

  it("omits when include_skill_content is false", () => {
    expect(
      shouldIncludeSkillContent({
        include_skill_content: false,
        skillVersion: "1+abc",
      }),
    ).toBe(false);
  });

  it("omits when known_skill_version matches", () => {
    expect(
      shouldIncludeSkillContent({
        include_skill_content: true,
        known_skill_version: "1+abc",
        skillVersion: "1+abc",
      }),
    ).toBe(false);
  });

  it("includes when known_skill_version differs", () => {
    expect(
      shouldIncludeSkillContent({
        include_skill_content: true,
        known_skill_version: "1+old",
        skillVersion: "1+abc",
      }),
    ).toBe(true);
  });
});

describe("buildBootstrapPayload", () => {
  it("includes playbook, changelog, and skill.content by default", () => {
    const tmp = path.join(os.tmpdir(), `agent-changelog-boot-${Date.now()}.yml`);
    fs.writeFileSync(
      tmp,
      `window_days: 6\nentries:\n  - date: "2099-01-01"\n    summary: "future"\n    tools_changed: true\n`,
      "utf-8",
    );
    const payload = buildBootstrapPayload({
      now: new Date("2099-01-02T00:00:00.000Z"),
      changelogFilePath: tmp,
      cwd: process.cwd(),
    });
    expect(payload.playbook_version).toBe(PLAYBOOK_VERSION);
    expect(payload.playbook).toMatch(/bootstrap_agent/);
    expect(payload.entries).toHaveLength(1);
    expect(payload.skill.path).toBe("mcp-server/agent-conventions.md");
    expect(payload.skill.version).toMatch(new RegExp(`^${CONVENTIONS_VERSION}\\+`));
    expect(payload.skill.content).toMatch(/force_variant/);
    expect(payload.skill.version).toBe(resolveSkillVersion(payload.skill.content!));
    expect(payload.session_guidance.some((s) => /known_skill_version/i.test(s))).toBe(true);
    fs.unlinkSync(tmp);
  });

  it("omits skill.content when include_skill_content is false", () => {
    const payload = buildBootstrapPayload({
      include_skill_content: false,
      cwd: process.cwd(),
    });
    expect(payload.skill.content).toBeUndefined();
    expect(payload.skill.version).toBeTruthy();
    expect(payload.entries).toBeDefined();
    expect(payload.playbook).toBeTruthy();
  });

  it("omits skill.content when known_skill_version matches", () => {
    const first = buildBootstrapPayload({ cwd: process.cwd() });
    const second = buildBootstrapPayload({
      known_skill_version: first.skill.version,
      cwd: process.cwd(),
    });
    expect(second.skill.content).toBeUndefined();
    expect(second.skill.version).toBe(first.skill.version);
  });
});
