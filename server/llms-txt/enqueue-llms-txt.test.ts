import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueJob = vi.hoisted(() => vi.fn());

vi.mock("../jobs/queue", () => ({
  enqueueJob,
}));

import { enqueueLlmsTxtRegenerate, LLMS_TXT_REGENERATE_JOB } from "./enqueue-llms-txt";

describe("enqueueLlmsTxtRegenerate", () => {
  beforeEach(() => {
    enqueueJob.mockReset();
  });

  it("enqueues with uniqueWhileAlive for the site", async () => {
    enqueueJob.mockResolvedValueOnce({ queued: true });
    const result = await enqueueLlmsTxtRegenerate({
      contentRoot: "site_test",
      siteId: "site_test",
      reason: "missing_template",
    });
    expect(result.queued).toBe(true);
    expect(enqueueJob).toHaveBeenCalledWith(
      LLMS_TXT_REGENERATE_JOB,
      expect.objectContaining({
        siteId: "site_test",
        contentRoot: "site_test",
        reason: "missing_template",
      }),
      expect.objectContaining({
        uniqueKey: `${LLMS_TXT_REGENERATE_JOB}:site_test`,
        uniqueWhileAlive: true,
      }),
    );
  });

  it("reports dedupe without throwing", async () => {
    enqueueJob.mockResolvedValueOnce({ queued: false, deduped: true });
    const result = await enqueueLlmsTxtRegenerate({
      contentRoot: "site_test",
      siteId: "site_test",
      reason: "staff",
    });
    expect(result.deduped).toBe(true);
  });
});
