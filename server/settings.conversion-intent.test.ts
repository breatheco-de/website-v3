import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { updateTrackingSettings } from "./settings";

const tmpDirs: string[] = [];

function makeContentRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "settings-tracking-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "settings.yml"), "tracking:\n  conversion_events: []\n", "utf-8");
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const whenToUse = "Visitor is applying or enrolling in a program via Apply or Enroll CTAs.";
const whenNot = "Soft info requests, download gates, newsletter, or contact — use other events.";

describe("updateTrackingSettings conversion intent", () => {
  it("rejects events missing when_to_use / when_not_to_use", () => {
    const root = makeContentRoot();
    expect(() =>
      updateTrackingSettings(
        {
          conversion_events: [{ name: "student_application", description: "Apply" }],
        },
        root,
      ),
    ).toThrow(/when_to_use/);
  });

  it("persists valid intent fields", () => {
    const root = makeContentRoot();
    updateTrackingSettings(
      {
        conversion_events: [
          {
            name: "student_application",
            description: "Apply / enroll",
            when_to_use: whenToUse,
            when_not_to_use: whenNot,
          },
        ],
      },
      root,
    );
    const raw = fs.readFileSync(path.join(root, "settings.yml"), "utf-8");
    expect(raw).toContain("when_to_use:");
    expect(raw).toContain("when_not_to_use:");
    expect(raw).toContain("student_application");
  });
});
