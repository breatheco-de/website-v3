import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const enqueueJob = vi.fn(async () => ({ queued: true }));
vi.mock("./jobs/queue", () => ({ enqueueJob }));

import { getJobState } from "./db-job-state";
import { vectorSearchNeedsSync } from "./database";
import {
  allowVectorIndexEnqueueForTests,
  clearVectorIndexEnqueueThrottleForTests,
  enqueueVectorIndexSync,
} from "./vector-index-queue";

describe("enqueueVectorIndexSync", () => {
  let contentRoot: string;

  beforeEach(() => {
    contentRoot = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "vector-queue-")), "site_test");
    fs.mkdirSync(contentRoot, { recursive: true });
    enqueueJob.mockClear();
    clearVectorIndexEnqueueThrottleForTests();
    allowVectorIndexEnqueueForTests(true);
  });

  afterEach(() => {
    allowVectorIndexEnqueueForTests(false);
  });

  it("is a no-op under vitest unless allowed", async () => {
    allowVectorIndexEnqueueForTests(false);
    expect(await enqueueVectorIndexSync(contentRoot, "faqs", "fetch")).toEqual({ queued: false });
    expect(enqueueJob).not.toHaveBeenCalled();
  });

  it("queues on the vector_index queue with retries and dedupe, and marks state queued", async () => {
    const res = await enqueueVectorIndexSync(contentRoot, "faqs", "manual");
    expect(res.queued).toBe(true);
    expect(enqueueJob).toHaveBeenCalledWith(
      "vector_index_sync",
      expect.objectContaining({ siteId: "site_test", contentRoot, dbName: "faqs", reason: "manual" }),
      expect.objectContaining({
        queue: "vector_index",
        uniqueKey: "vector:site_test:faqs",
        uniqueWhileAlive: true,
        maxAttempts: 5,
      }),
    );
    expect(getJobState("faqs", contentRoot).index.status).toBe("queued");
  });

  it("throttles repeated automatic triggers but not explicit ones", async () => {
    await enqueueVectorIndexSync(contentRoot, "faqs", "missing_collection");
    const second = await enqueueVectorIndexSync(contentRoot, "faqs", "missing_collection");
    expect(second).toEqual({ queued: false, throttled: true });
    await enqueueVectorIndexSync(contentRoot, "faqs", "manual");
    expect(enqueueJob).toHaveBeenCalledTimes(2);
  });

  it("uses a separate dedupe key for rebuilds", async () => {
    await enqueueVectorIndexSync(contentRoot, "faqs", "rebuild", { rebuild: true });
    expect(enqueueJob).toHaveBeenCalledWith(
      "vector_index_sync",
      expect.objectContaining({ rebuild: true }),
      expect.objectContaining({ uniqueKey: "vector:site_test:faqs:rebuild" }),
    );
  });
});

describe("vectorSearchNeedsSync", () => {
  it("is true when vector search is turned on or its fields change", () => {
    expect(vectorSearchNeedsSync(undefined, { enabled: true, fields: ["q"] })).toBe(true);
    expect(vectorSearchNeedsSync({ enabled: false, fields: ["q"] }, { enabled: true, fields: ["q"] })).toBe(true);
    expect(vectorSearchNeedsSync({ enabled: true, fields: ["q"] }, { enabled: true, fields: ["q", "a"] })).toBe(true);
  });

  it("is false when unchanged or turned off", () => {
    expect(vectorSearchNeedsSync({ enabled: true, fields: ["q"] }, { enabled: true, fields: ["q"] })).toBe(false);
    expect(vectorSearchNeedsSync({ enabled: true, fields: ["q"] }, { enabled: false, fields: ["q"] })).toBe(false);
    expect(vectorSearchNeedsSync({ enabled: true, fields: ["q"] }, undefined)).toBe(false);
  });
});
