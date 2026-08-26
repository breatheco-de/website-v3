import { useCallback, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";

export type SystemAlertSeverity = "critical" | "warning";

export type SystemAlertCode =
  | "gcs_migration_required"
  | "database_auth_env_missing"
  | "database_auth_failed"
  | "database_fetch_failed"
  | "turnstile_env_missing"
  | "turnstile_secret_invalid"
  | "background_jobs_stalled"
  | "sidequest_engine_down"
  | "sidequest_engine_stuck"
  | "github_app_env_missing";

export interface SystemAlert {
  id: string;
  severity: SystemAlertSeverity;
  code: SystemAlertCode;
  title: string;
  message: string;
  actionHref?: string;
  actionLabel?: string;
  site?: string;
  database?: string;
}

interface SystemAlertsResponse {
  alerts: SystemAlert[];
}

export interface GcsRecheckResponse {
  migrationRequired: boolean;
  bucketName: string | null;
  available: boolean;
  message: string;
  diagnostics?: {
    knownSitePrefixes: string[];
    hasOldLayout: boolean;
    hasNewLayout: boolean;
    mediaSegment: string;
    checkError?: string;
  };
}

export interface DatabaseRecheckResponse {
  found: boolean;
  resolved: boolean;
  errorCount: number;
  warningCount: number;
  message: string;
}

export function useSystemAlerts() {
  const queryClient = useQueryClient();
  const { isValidated, hasToken, isLoading: authLoading } = useDebugAuth();
  const enabled = isValidated === true && hasToken;
  const [recheckingGcs, setRecheckingGcs] = useState(false);
  const [recheckMessage, setRecheckMessage] = useState<string | null>(null);
  const [recheckingDbId, setRecheckingDbId] = useState<string | null>(null);
  const [dbRecheckMessages, setDbRecheckMessages] = useState<Record<string, string>>({});
  const [recheckingSidequest, setRecheckingSidequest] = useState(false);
  const [sidequestRecheckMessage, setSidequestRecheckMessage] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery<SystemAlertsResponse>({
    queryKey: ["/api/admin/system-alerts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/system-alerts", {
        headers: getSessionHeaders(),
      });
      if (!res.ok) throw new Error("Failed to fetch system alerts");
      return res.json();
    },
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const recheckGcsMigration = useCallback(async () => {
    setRecheckingGcs(true);
    setRecheckMessage(null);
    try {
      const res = await fetch("/api/admin/gcs-recheck-migration", {
        method: "POST",
        headers: getSessionHeaders(),
      });
      if (!res.ok) throw new Error("Failed to re-check GCS migration");
      const body = (await res.json()) as GcsRecheckResponse;
      setRecheckMessage(body.message);
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/system-alerts"] });
      return body;
    } finally {
      setRecheckingGcs(false);
    }
  }, [queryClient]);

  const recheckDatabase = useCallback(
    async (alert: SystemAlert) => {
      if (!alert.database) return;
      setRecheckingDbId(alert.id);
      try {
        const res = await fetch("/api/admin/database-recheck", {
          method: "POST",
          headers: { ...getSessionHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({ database: alert.database, site: alert.site }),
        });
        if (!res.ok) throw new Error("Failed to re-check database");
        const body = (await res.json()) as DatabaseRecheckResponse;
        setDbRecheckMessages((prev) => ({ ...prev, [alert.id]: body.message }));
        await queryClient.invalidateQueries({ queryKey: ["/api/admin/system-alerts"] });
        return body;
      } finally {
        setRecheckingDbId(null);
      }
    },
    [queryClient],
  );

  const recheckSidequest = useCallback(async () => {
    setRecheckingSidequest(true);
    setSidequestRecheckMessage(null);
    try {
      const res = await fetch("/api/admin/sidequest/recheck", {
        method: "POST",
        headers: { ...getSessionHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to re-check Sidequest");
      const body = (await res.json()) as { message?: string; summary?: string };
      setSidequestRecheckMessage(body.message ?? body.summary ?? "Re-check complete.");
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/system-alerts"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/sidequest/diagnostics"] });
      return body;
    } finally {
      setRecheckingSidequest(false);
    }
  }, [queryClient]);

  const alerts = data?.alerts ?? [];
  const criticalAlerts = alerts.filter((a) => a.severity === "critical");
  const warningAlerts = alerts.filter((a) => a.severity === "warning");

  return {
    alerts,
    criticalAlerts,
    warningAlerts,
    hasAlerts: alerts.length > 0,
    isLoading: authLoading || (enabled && isLoading),
    isFetching,
    recheckGcsMigration,
    recheckingGcs,
    recheckMessage,
    recheckDatabase,
    recheckingDbId,
    dbRecheckMessages,
    recheckSidequest,
    recheckingSidequest,
    sidequestRecheckMessage,
  };
}
