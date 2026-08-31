import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getSessionHeaders } from "@/lib/sessionHeaders";

export type SidequestDerivedHealth = "stopped" | "running" | "running_idle" | "running_stuck";

export type SidequestDiagnostics = {
  engine: {
    status: string;
    pid?: number;
    pidFileExists: boolean;
  };
  heartbeat: {
    exists: boolean;
    ageMs: number | null;
    payload: { currentJob?: string; ts?: string } | null;
  };
  derivedHealth: SidequestDerivedHealth;
  outbox: {
    unpublishedCount: number;
    oldestAgeMs: number | null;
    behindBy: number;
  };
  restart: {
    available: boolean;
    mechanism: string;
    pathUnitDetected: boolean;
    pending: boolean;
  };
  summary: string;
  queueDb?: {
    countsByState: Record<string, number>;
    recentFailed: Array<{ class: string; errorsPreview: string | null }>;
    error?: string;
  };
};

export type SidequestLogsResponse = {
  source: string;
  lines: string[];
  truncated: boolean;
  hint?: string;
};

export function useSidequestDiagnostics(site?: string, enabled = true) {
  return useQuery<SidequestDiagnostics>({
    queryKey: ["/api/admin/sidequest/diagnostics", site],
    queryFn: async () => {
      const qs = site ? `?site=${encodeURIComponent(site)}` : "";
      const res = await fetch(`/api/admin/sidequest/diagnostics${qs}`, {
        headers: getSessionHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch Sidequest diagnostics");
      return res.json();
    },
    enabled,
    staleTime: 10_000,
  });
}

export function useSidequestLogs(enabled = false) {
  return useQuery<SidequestLogsResponse>({
    queryKey: ["/api/admin/sidequest/logs"],
    queryFn: async () => {
      const res = await fetch("/api/admin/sidequest/logs?lines=80", {
        headers: getSessionHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch Sidequest logs");
      return res.json();
    },
    enabled,
  });
}

export type SidequestRestartPhase = "idle" | "restarting" | "online" | "failed";

const POLL_INTERVAL_MS = 2000;
const RESTART_TIMEOUT_MS = 90_000;

export function useSidequestRestart(site?: string) {
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<SidequestRestartPhase>("idle");
  const [message, setMessage] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    setPhase("idle");
    setMessage("");
  }, [clearTimer]);

  const start = useCallback(async () => {
    clearTimer();
    setPhase("restarting");
    setMessage("Sending restart signal…");

    try {
      const res = await fetch("/api/admin/sidequest/restart", {
        method: "POST",
        headers: { ...getSessionHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setPhase("failed");
        setMessage(data.error || `Restart failed (${res.status}).`);
        return;
      }
      setMessage(data.message || "Restart initiated — waiting for engine…");
    } catch (err) {
      setPhase("failed");
      setMessage(err instanceof Error ? err.message : "Restart request failed.");
      return;
    }

    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    const qs = site ? `?site=${encodeURIComponent(site)}` : "";

    const poll = async () => {
      if (Date.now() > deadline) {
        setPhase("failed");
        setMessage("Sidequest did not report running within 90 seconds.");
        return;
      }
      try {
        const res = await fetch(`/api/admin/sidequest/diagnostics${qs}`, {
          headers: getSessionHeaders(),
          cache: "no-store",
        });
        if (res.ok) {
          const body = (await res.json()) as SidequestDiagnostics;
          if (body.derivedHealth !== "stopped") {
            setPhase("online");
            setMessage("Sidequest is running ✓");
            void queryClient.invalidateQueries({ queryKey: ["/api/admin/system-alerts"] });
            void queryClient.invalidateQueries({ queryKey: ["/api/admin/pipeline/status"] });
            void queryClient.invalidateQueries({ queryKey: ["/api/admin/sidequest/diagnostics"] });
            return;
          }
        }
      } catch {
        // keep polling
      }
      timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
  }, [clearTimer, queryClient, site]);

  return { phase, message, start, reset };
}
