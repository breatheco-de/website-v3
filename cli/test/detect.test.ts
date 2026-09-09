import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { detectProject } from "../src/detect";

const dirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "weblify-detect-"));
  dirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

describe("detectProject", () => {
  it("empty folder", () => {
    const d = tmp();
    expect(detectProject(d).kind).toBe("empty");
  });

  it("project when sites.yml exists", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "sites.yml"), "localhost:\n  content_folder: site_x\n");
    expect(detectProject(d).kind).toBe("project");
  });

  it("dirty when unrelated files", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, "README.md"), "hi");
    expect(detectProject(d).kind).toBe("dirty");
  });

  it("allows .gitignore alone as empty", () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, ".gitignore"), ".env\n");
    expect(detectProject(d).kind).toBe("empty");
  });
});
