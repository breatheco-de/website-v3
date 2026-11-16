import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  compileLlmsTxt,
  invalidateLlmsCompiledCache,
  llmsTemplateExists,
} from "./compile";
import { LLMS_TEMPLATE_BASENAME } from "./regenerate-prompt";

describe("compileLlmsTxt", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llms-compile-"));
    invalidateLlmsCompiledCache();
  });

  afterEach(() => {
    invalidateLlmsCompiledCache(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("returns missing_template when file absent", () => {
    expect(llmsTemplateExists(tmp)).toBe(false);
    expect(compileLlmsTxt(tmp)).toEqual({ ok: false, reason: "missing_template" });
  });

  it("compiles a plain markdown template and caches", () => {
    fs.writeFileSync(
      path.join(tmp, LLMS_TEMPLATE_BASENAME),
      "# 4Geeks Academy\n\n> Hello\n",
      "utf-8",
    );
    const first = compileLlmsTxt(tmp);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.body).toContain("# 4Geeks Academy");
    expect(first.fromCache).toBe(false);

    const second = compileLlmsTxt(tmp);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.fromCache).toBe(true);
    expect(second.body).toBe(first.body);
  });

  it("busts cache when template mtime changes", async () => {
    const file = path.join(tmp, LLMS_TEMPLATE_BASENAME);
    fs.writeFileSync(file, "# One\n", "utf-8");
    const first = compileLlmsTxt(tmp);
    expect(first.ok && first.body).toContain("# One");

    await new Promise((r) => setTimeout(r, 20));
    fs.writeFileSync(file, "# Two\n", "utf-8");
    const second = compileLlmsTxt(tmp);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.fromCache).toBe(false);
    expect(second.body).toContain("# Two");
  });
});
