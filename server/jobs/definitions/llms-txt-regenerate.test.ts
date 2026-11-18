import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const complete = vi.fn();
const getLLMService = vi.fn(() => ({ complete }));
const markFileAsModified = vi.fn();
const notifyContentDirtiesRequeued = vi.fn();
const invalidateLlmsCompiledCache = vi.fn();
const buildLlmsTxtInputs = vi.fn();
const readLlmsTxtPrompt = vi.fn();
const fillLlmsTxtPrompt = vi.fn();

vi.mock("../../ai/LLMService", () => ({
  getLLMService,
}));

vi.mock("../../sync-state", () => ({
  markFileAsModified,
}));

vi.mock("../../auto-commit", () => ({
  notifyContentDirtiesRequeued,
}));

vi.mock("../../llms-txt/compile", () => ({
  invalidateLlmsCompiledCache,
}));

vi.mock("../../llms-txt/regenerate-prompt", async () => {
  const actual = await vi.importActual<typeof import("../../llms-txt/regenerate-prompt")>(
    "../../llms-txt/regenerate-prompt",
  );
  return {
    ...actual,
    buildLlmsTxtInputs,
    readLlmsTxtPrompt,
    fillLlmsTxtPrompt,
  };
});

describe("LlmsTxtRegenerateJob", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "llms-job-"));
    complete.mockReset();
    getLLMService.mockReset().mockReturnValue({ complete });
    markFileAsModified.mockReset();
    notifyContentDirtiesRequeued.mockReset().mockResolvedValue(undefined);
    invalidateLlmsCompiledCache.mockReset();
    buildLlmsTxtInputs.mockReset().mockReturnValue({
      company_profile: "c",
      site_facts: "s",
      products: "p",
      pages: "g",
      previous_llms_txt: "",
      pageRows: [],
    });
    readLlmsTxtPrompt.mockReset();
    fillLlmsTxtPrompt.mockReset().mockReturnValue("filled");
  });

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("fails when llms.txt prompt file is missing", async () => {
    readLlmsTxtPrompt.mockReturnValue(null);
    const { LlmsTxtRegenerateJob } = await import("./llms-txt-regenerate");
    const job = new LlmsTxtRegenerateJob();
    const result = await job.run({ contentRoot: tmp, siteId: "site_test", reason: "test" });
    expect(result).toEqual({ ok: false, reason: "missing_llms_txt_prompt" });
    expect(complete).not.toHaveBeenCalled();
    expect(markFileAsModified).not.toHaveBeenCalled();
  });

  it("writes template, marks dirty, and notifies requeue without commitSingleFile", async () => {
    readLlmsTxtPrompt.mockReturnValue("Prompt {{products}}");
    complete.mockResolvedValue("# Hello\n\nBody\n");
    const { LlmsTxtRegenerateJob } = await import("./llms-txt-regenerate");
    const job = new LlmsTxtRegenerateJob();
    const result = await job.run({ contentRoot: tmp, siteId: path.basename(tmp), reason: "test" });

    expect(result.ok).toBe(true);
    expect(getLLMService).toHaveBeenCalledWith({ dangerouslyAllowBrowser: true });
    expect(fs.readFileSync(path.join(tmp, "llms.template.md"), "utf-8")).toContain("# Hello");
    expect(markFileAsModified).toHaveBeenCalledWith(
      "llms.template.md",
      "agent",
      undefined,
      tmp,
    );
    expect(notifyContentDirtiesRequeued).toHaveBeenCalledWith({
      files: [`${path.basename(tmp)}/llms.template.md`],
      author: "agent",
    });
    expect(invalidateLlmsCompiledCache).toHaveBeenCalledWith(tmp);
  });
});
