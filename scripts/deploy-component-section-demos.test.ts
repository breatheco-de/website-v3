import { describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("deploy.sh component section demo wipe", () => {
  it("wipes persistent .cache/component-section-demos on redeploy", () => {
    const deploySh = fs.readFileSync(
      path.join(process.cwd(), "scripts/deploy.sh"),
      "utf8",
    );
    expect(deploySh).toContain('rm -rf "$PERSISTENT/.cache/component-section-demos"');
    expect(deploySh).toContain('mkdir -p "$PERSISTENT/.cache/component-section-demos"');
  });
});
