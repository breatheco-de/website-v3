import fs from "fs";
import os from "os";
import path from "path";
import { beforeEach, describe, expect, it } from "vitest";
import { displayIndexStatus, getAllJobStates, getJobState, setJobState } from "./db-job-state";

describe("db-job-state", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "db-job-state-"));
  });

  it("returns idle defaults when nothing was written", () => {
    expect(getJobState("faqs", root)).toEqual({ fetch: { status: "idle" }, index: { status: "idle" } });
  });

  it("keeps a write made by another process (file changed on disk) when merging", async () => {
    setJobState("faqs", "fetch", { status: "done", fetched: 10 }, root);

    // Another process (the Sidequest worker) rewrites the file with its own index state.
    await new Promise((r) => setTimeout(r, 10));
    const file = path.join(root, ".db-job-state.json");
    const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
    onDisk.faqs.index = { status: "done", ready: true, collection: "x__faqs" };
    onDisk.testimonials = { fetch: { status: "idle" }, index: { status: "running" } };
    fs.writeFileSync(file, JSON.stringify(onDisk));

    setJobState("faqs", "fetch", { status: "running" }, root);

    const all = getAllJobStates(root);
    expect(all.faqs.fetch).toMatchObject({ status: "running", fetched: 10 });
    expect(all.faqs.index).toMatchObject({ status: "done", ready: true });
    expect(all.testimonials.index.status).toBe("running");
  });

  it("scopes state to the content root", () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "db-job-state-other-"));
    setJobState("faqs", "index", { status: "queued" }, root);
    expect(getJobState("faqs", other).index.status).toBe("idle");
    expect(getJobState("faqs", root).index.status).toBe("queued");
  });

  it("shows queued jobs as waiting_worker when the worker is down", () => {
    expect(displayIndexStatus({ status: "queued" }, false)).toBe("waiting_worker");
    expect(displayIndexStatus({ status: "queued" }, true)).toBe("queued");
    expect(displayIndexStatus({ status: "running" }, false)).toBe("running");
  });
});
