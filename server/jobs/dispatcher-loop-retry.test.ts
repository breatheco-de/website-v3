import { afterEach, describe, expect, it, vi } from "vitest";
import { installDispatcherLoopRetry, type DispatcherLoopHost } from "./dispatcher-loop-retry";

afterEach(() => {
  vi.useRealTimers();
});

function host(listen: DispatcherLoopHost["listen"]): DispatcherLoopHost {
  return { isRunning: false, listen, start() {} };
}

describe("installDispatcherLoopRetry", () => {
  it("starts the poll loop again after it throws", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const dispatcher = host(async function listen(this: DispatcherLoopHost) {
      calls += 1;
      if (calls === 1) throw new Error("database is locked");
      await new Promise<void>((resolve) => {
        const timer = setInterval(() => {
          if (!this.isRunning) {
            clearInterval(timer);
            resolve();
          }
        }, 10);
      });
    });
    const warnings: string[] = [];
    installDispatcherLoopRetry(dispatcher, (_meta, message) => warnings.push(message));

    dispatcher.start();
    await Promise.resolve();
    expect(calls).toBe(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls).toBe(2);
    expect(warnings).toEqual(["[JobQueue] Dispatcher loop crashed; starting it again"]);

    dispatcher.isRunning = false;
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toBe(2);
  });

  it("does not start again after a clean stop", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const dispatcher = host(async () => {
      calls += 1;
    });
    installDispatcherLoopRetry(dispatcher, () => {});

    dispatcher.start();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(1);
  });

  it("does not retry when the loop is stopped before the delay", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const dispatcher = host(async () => {
      calls += 1;
      throw new Error("database is locked");
    });
    installDispatcherLoopRetry(dispatcher, () => {});

    dispatcher.start();
    await Promise.resolve();
    dispatcher.isRunning = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toBe(1);
  });
});
