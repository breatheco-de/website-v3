import { beforeEach, describe, expect, it, vi } from "vitest";
import { Job } from "sidequest";

const { enqueueMock, builder } = vi.hoisted(() => {
  const enqueueMock = vi.fn();
  const builder = {
    queue: vi.fn(function (this: unknown) {
      return this;
    }),
    unique: vi.fn(function (this: unknown) {
      return this;
    }),
    availableAt: vi.fn(function (this: unknown) {
      return this;
    }),
    maxAttempts: vi.fn(function (this: unknown) {
      return this;
    }),
    retryDelay: vi.fn(function (this: unknown) {
      return this;
    }),
    backoffStrategy: vi.fn(function (this: unknown) {
      return this;
    }),
    enqueue: enqueueMock,
  };
  return { enqueueMock, builder };
});

vi.mock("sidequest", async (importOriginal) => {
  const actual = await importOriginal<typeof import("sidequest")>();
  return {
    ...actual,
    Sidequest: {
      ...actual.Sidequest,
      configure: vi.fn(async () => undefined),
      build: vi.fn(() => builder),
    },
  };
});

import { enqueueJob, isSqliteBusyError, registerJobClass } from "./queue";

class BusyProbeJob extends Job {
  async run() {
    return null;
  }
}

registerJobClass("busy_probe", BusyProbeJob);

describe("isSqliteBusyError", () => {
  it("detects better-sqlite3 SQLITE_BUSY code", () => {
    expect(isSqliteBusyError(Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }))).toBe(
      true,
    );
  });

  it("detects SQLITE_LOCKED and snapshot busy codes", () => {
    expect(isSqliteBusyError({ code: "SQLITE_LOCKED", message: "x" })).toBe(true);
    expect(isSqliteBusyError({ code: "SQLITE_BUSY_SNAPSHOT", message: "x" })).toBe(true);
  });

  it("detects message-only locked errors", () => {
    expect(isSqliteBusyError(new Error("insert into sidequest_jobs ... database is locked"))).toBe(true);
    expect(isSqliteBusyError("SqliteError: SQLITE_BUSY")).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isSqliteBusyError(new Error("UNIQUE constraint failed"))).toBe(false);
    expect(isSqliteBusyError(null)).toBe(false);
    expect(isSqliteBusyError(undefined)).toBe(false);
    expect(isSqliteBusyError({ code: "SQLITE_CONSTRAINT", message: "unique" })).toBe(false);
  });
});

describe("enqueueJob SQLITE_BUSY", () => {
  beforeEach(() => {
    enqueueMock.mockReset();
    builder.queue.mockClear();
    builder.unique.mockClear();
  });

  it("returns busy instead of throwing when Sidequest hits database is locked", async () => {
    enqueueMock.mockRejectedValueOnce(
      Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" }),
    );

    await expect(
      enqueueJob("busy_probe", { site: "site_4geeks-com" }, { uniqueKey: "busy_probe", uniqueWithArgs: false }),
    ).resolves.toEqual({ queued: false, busy: true });

    expect(enqueueMock).toHaveBeenCalledTimes(1);
  });

  it("still queues successfully when enqueue works", async () => {
    enqueueMock.mockResolvedValueOnce({ id: 1 });

    await expect(enqueueJob("busy_probe", { site: "site_4geeks-com" })).resolves.toEqual({ queued: true });
  });

  it("still throws unrelated enqueue failures", async () => {
    enqueueMock.mockRejectedValueOnce(new Error("disk full"));

    await expect(enqueueJob("busy_probe", { site: "site_4geeks-com" })).rejects.toThrow("disk full");
  });
});
