import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearOnSaveValidationSchedules,
  ON_SAVE_VALIDATION_DEBOUNCE_MS,
  pendingOnSaveValidationCount,
  scheduleOnSaveValidationJob,
} from "./onSaveValidationScheduler";

vi.mock("../jobs/queue", () => ({
  enqueueJob: vi.fn(async () => ({ queued: true })),
}));

import { enqueueJob } from "../jobs/queue";

describe("onSaveValidationScheduler", () => {
  afterEach(() => {
    clearOnSaveValidationSchedules();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("coalesces multiple writes within the debounce window into one enqueue", async () => {
    vi.useFakeTimers();
    const args = {
      site: "site_test",
      contentRoot: "/tmp/site_test",
      entryKey: "page/home/en",
      contentType: "page",
      slug: "home",
      locale: "en",
    };

    scheduleOnSaveValidationJob(args);
    scheduleOnSaveValidationJob(args);
    scheduleOnSaveValidationJob(args);
    expect(pendingOnSaveValidationCount()).toBe(1);
    expect(enqueueJob).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(ON_SAVE_VALIDATION_DEBOUNCE_MS - 1);
    expect(enqueueJob).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(enqueueJob).toHaveBeenCalledTimes(1);
    expect(enqueueJob).toHaveBeenCalledWith(
      "on_save_validation",
      expect.objectContaining({ entryKey: "page/home/en", slug: "home" }),
    );
    expect(pendingOnSaveValidationCount()).toBe(0);
  });

  it("schedules a new job after a prior debounce has fired", async () => {
    vi.useFakeTimers();
    const args = {
      site: "site_test",
      contentRoot: "/tmp/site_test",
      entryKey: "page/home/en",
      contentType: "page",
      slug: "home",
      locale: "en",
    };

    scheduleOnSaveValidationJob(args);
    await vi.advanceTimersByTimeAsync(ON_SAVE_VALIDATION_DEBOUNCE_MS);
    expect(enqueueJob).toHaveBeenCalledTimes(1);

    scheduleOnSaveValidationJob(args);
    await vi.advanceTimersByTimeAsync(ON_SAVE_VALIDATION_DEBOUNCE_MS);
    expect(enqueueJob).toHaveBeenCalledTimes(2);
  });
});
