import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { compileLlmsTxt, invalidateLlmsCompiledCache } from "./compile";
import { LLMS_TEMPLATE_BASENAME } from "./regenerate-prompt";

const enqueueLlmsTxtRegenerate = vi.hoisted(() => vi.fn());

vi.mock("./enqueue", () => ({
  enqueueLlmsTxtRegenerate,
}));

describe("public missing template path", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llms-serve-"));
    invalidateLlmsCompiledCache();
    enqueueLlmsTxtRegenerate.mockReset();
    enqueueLlmsTxtRegenerate.mockResolvedValue({ queued: true, siteId: "t" });
  });

  it("compile fails without template (caller enqueues)", async () => {
    const compiled = compileLlmsTxt(tmp);
    expect(compiled.ok).toBe(false);
    if (compiled.ok) return;
    expect(compiled.reason).toBe("missing_template");
    // Mimic route handler
    if (!compiled.ok) {
      await enqueueLlmsTxtRegenerate({ contentRoot: tmp, reason: "missing_template" });
    }
    expect(enqueueLlmsTxtRegenerate).toHaveBeenCalledTimes(1);
  });

  it("successful compile does not need enqueue", () => {
    fs.writeFileSync(path.join(tmp, LLMS_TEMPLATE_BASENAME), "# Ok\n", "utf-8");
    const compiled = compileLlmsTxt(tmp);
    expect(compiled.ok).toBe(true);
    expect(enqueueLlmsTxtRegenerate).not.toHaveBeenCalled();
  });
});
