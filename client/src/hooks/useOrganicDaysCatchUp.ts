/**
 * Catch up missing GSC organic day-cache files (mode: "missing" only).
 * Percent is based on the gap at start of this run, not the full 60-day horizon.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/queryClient";

export type OrganicDaysCatchUpResult =
  | { ok: true; nothingLeft: boolean }
  | { ok: false; error: string; aborted?: boolean };

type BackfillBody = {
  ok?: boolean;
  error?: string;
  remaining?: number;
  days_expected?: number;
  date?: string;
};

async function postMissingDay(signal?: AbortSignal): Promise<BackfillBody> {
  const res = await apiFetch("/api/seo/organic/days/backfill", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "missing" }),
    signal,
  });
  const body = (await res.json()) as BackfillBody;
  if (!res.ok && body.ok !== false) {
    return {
      ok: false,
      error: body.error || `Backfill failed (${res.status})`,
      remaining: body.remaining,
    };
  }
  return body;
}

function clampPercent(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function useOrganicDaysCatchUp() {
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  /** After a successful catch-up with remaining===0, hide the control until remount. */
  const [nothingLeftToPull, setNothingLeftToPull] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef(0);
  const runningRef = useRef(false);

  useEffect(() => {
    return () => {
      runIdRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      runningRef.current = false;
    };
  }, []);

  const start = useCallback(async (): Promise<OrganicDaysCatchUpResult> => {
    if (runningRef.current) {
      return { ok: false, error: "Catch-up already running" };
    }

    runIdRef.current += 1;
    const runId = runIdRef.current;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    runningRef.current = true;
    setRunning(true);
    setPercent(0);
    setError(null);

    let initialRemaining: number | null = null;

    const finishAbort = (): OrganicDaysCatchUpResult => {
      runningRef.current = false;
      setRunning(false);
      setPercent(0);
      return { ok: false, error: "Aborted", aborted: true };
    };

    try {
      for (;;) {
        if (ac.signal.aborted || runId !== runIdRef.current) {
          return finishAbort();
        }

        const body = await postMissingDay(ac.signal);
        if (ac.signal.aborted || runId !== runIdRef.current) {
          return finishAbort();
        }

        const remaining = body.remaining ?? 0;

        if (body.ok === false) {
          const message = body.error || "Could not catch up missing days";
          setError(message);
          setPercent(0);
          runningRef.current = false;
          setRunning(false);
          return { ok: false, error: message };
        }

        if (initialRemaining == null) {
          if (remaining <= 0) {
            // Nothing was missing, or the sole missing day was just ingested.
            setNothingLeftToPull(true);
            setPercent(100);
            runningRef.current = false;
            setRunning(false);
            return { ok: true, nothingLeft: true };
          }
          // Response is after one successful ingest: gap at start was remaining + 1.
          initialRemaining = remaining + 1;
        }

        const done = initialRemaining - remaining;
        setPercent(clampPercent((done / Math.max(1, initialRemaining)) * 100));

        if (remaining <= 0) {
          setNothingLeftToPull(true);
          setPercent(100);
          runningRef.current = false;
          setRunning(false);
          return { ok: true, nothingLeft: true };
        }
      }
    } catch (err) {
      if (ac.signal.aborted || runId !== runIdRef.current) {
        return finishAbort();
      }
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setPercent(0);
      runningRef.current = false;
      setRunning(false);
      return { ok: false, error: message };
    }
  }, []);

  return {
    running,
    percent,
    error,
    nothingLeftToPull,
    start,
  };
}
