/**
 * Sidequest's dispatcher starts its poll loop once. If that promise rejects
 * (for example SQLite "database is locked"), the process stays up and the
 * loop never runs again. Re-arm it here so a crash does not need a restart.
 */

const INSTALLED = Symbol.for("website-v3.dispatcher-loop-retry");

export type DispatcherLoopHost = {
  isRunning: boolean;
  listen: () => Promise<void>;
  start: () => void;
};

type Warn = (meta: Record<string, unknown>, message: string) => void;

const RETRY_RESET_AFTER_MS = 60_000;

function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.min(attempt, 5));
}

export function installDispatcherLoopRetry(proto: DispatcherLoopHost, warn: Warn): void {
  const flagged = proto as DispatcherLoopHost & { [INSTALLED]?: boolean };
  if (flagged[INSTALLED]) return;
  flagged[INSTALLED] = true;

  proto.start = function startWithRetry(this: DispatcherLoopHost) {
    this.isRunning = true;
    const again = (attempt: number) => {
      const started = Date.now();
      void this.listen()
        .then(() => {
          // listen() returns only when stop() clears isRunning.
        })
        .catch((error: unknown) => {
          if (!this.isRunning) return;
          const crashedImmediately = Date.now() - started < RETRY_RESET_AFTER_MS;
          const nextAttempt = crashedImmediately ? attempt + 1 : 0;
          const delayMs = retryDelayMs(crashedImmediately ? attempt : 0);
          warn(
            { err: error, delayMs },
            "[JobQueue] Dispatcher loop crashed; starting it again",
          );
          const timer = setTimeout(() => {
            if (this.isRunning) again(nextAttempt);
          }, delayMs);
          timer.unref?.();
        });
    };
    again(0);
  };
}
