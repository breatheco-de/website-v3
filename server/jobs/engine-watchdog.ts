/**
 * Watchdog: alert when unpublished events are stale (engine may be down).
 */

import { getOldestUnpublishedAgeMs } from "../events/event-store";
import { getSiteContextMap } from "../site-manager";
import { child } from "../logger";

const log = child({ module: "engine-watchdog" });

const STALE_THRESHOLD_MS = Number(process.env.EVENT_STALE_THRESHOLD_MS || 5 * 60 * 1000);
const alertedSites = new Set<string>();

let timer: ReturnType<typeof setInterval> | null = null;

export type EngineWatchdogAlert = {
  site: string;
  ageMs: number;
  message: string;
};

const alertListeners = new Set<(alert: EngineWatchdogAlert) => void>();

export function onEngineWatchdogAlert(cb: (alert: EngineWatchdogAlert) => void): void {
  alertListeners.add(cb);
}

export function startEngineWatchdog(): void {
  if (timer) return;
  const tick = () => {
    for (const ctx of getSiteContextMap().values()) {
      const age = getOldestUnpublishedAgeMs(ctx.contentRootName);
      if (age === null) {
        alertedSites.delete(ctx.contentRootName);
        continue;
      }
      if (age > STALE_THRESHOLD_MS && !alertedSites.has(ctx.contentRootName)) {
        alertedSites.add(ctx.contentRootName);
        const alert: EngineWatchdogAlert = {
          site: ctx.contentRootName,
          ageMs: age,
          message: `Background jobs stalled for ${Math.round(age / 1000)}s — index/validation may be behind.`,
        };
        log.error(alert, "[EngineWatchdog] stale unpublished events");
        for (const cb of alertListeners) cb(alert);
      }
    }
  };
  tick();
  timer = setInterval(tick, 60_000);
  timer.unref();
}

export function stopEngineWatchdog(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
