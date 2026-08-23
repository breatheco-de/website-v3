import { useEffect, useState } from "react";
import { AlertTriangle, Check, Clock, Loader2 } from "lucide-react";

export type PipelineCountsData = {
  status?: "ok" | "degraded" | "stalled";
  outbox: { unpublishedCount: number };
  inFlight: {
    indexRefresh: boolean;
    validations: unknown[];
    propagations: unknown[];
  };
  recentFailures: unknown[];
};

export type PipelineVisualState = "loading" | "idle" | "degraded" | "stalled" | "active";

function pipelineActivityTotals(data: PipelineCountsData | null | undefined) {
  const queued = data?.outbox.unpublishedCount ?? 0;
  const running =
    (data?.inFlight.validations.length ?? 0) +
    (data?.inFlight.propagations.length ?? 0) +
    (data?.inFlight.indexRefresh ? 1 : 0);
  const failed = data?.recentFailures.length ?? 0;
  return { queued, running, failed, total: queued + running + failed };
}

export function getPipelineVisualState(
  data: PipelineCountsData | null | undefined,
  loading: boolean,
): PipelineVisualState {
  const { total } = pipelineActivityTotals(data);
  if (loading && total === 0) return "loading";
  if (total > 0) return "active";
  if (data?.status === "stalled") return "stalled";
  if (data?.status === "degraded") return "degraded";
  if (data) return "idle";
  return "loading";
}

function TypingDots() {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((n) => (n % 3) + 1);
    }, 350);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="inline-block w-[1.8em] text-[10px] leading-none text-muted-foreground"
      aria-hidden
      data-testid="badge-pipeline-counts-loading"
    >
      {".".repeat(count)}
    </span>
  );
}

export function PipelineCounts({
  data,
  loading,
}: {
  data: PipelineCountsData | null | undefined;
  loading: boolean;
}) {
  const { queued, running, failed, total } = pipelineActivityTotals(data);
  const visualState = getPipelineVisualState(data, loading);

  if (visualState === "loading" && total === 0) return <TypingDots />;

  if (total === 0) {
    if (visualState === "stalled") {
      return (
        <span
          className="inline-flex items-center text-[10px] text-destructive gap-0.5"
          aria-label="Pipeline stalled"
          data-testid="badge-pipeline-counts-stalled"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
        </span>
      );
    }
    if (visualState === "degraded") {
      return (
        <span
          className="inline-flex items-center text-[10px] text-amber-600 dark:text-amber-400 gap-0.5"
          aria-label="Pipeline degraded"
          data-testid="badge-pipeline-counts-degraded"
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
        </span>
      );
    }
    if (visualState === "idle") {
      return (
        <span
          className="inline-flex items-center text-[10px] text-chart-3 gap-0.5"
          aria-label="Pipeline idle"
          data-testid="badge-pipeline-counts-idle"
        >
          <Check className="h-3 w-3 shrink-0" />
        </span>
      );
    }
    return null;
  }

  return (
    <span
      className="inline-flex items-center text-[10px] tabular-nums leading-none"
      aria-label={`${queued} queued, ${running} running, ${failed} failed`}
      data-testid="badge-pipeline-counts"
    >
      {queued > 0 && (
        <span className="inline-flex items-center text-amber-600 dark:text-amber-400">
          <Clock className="size-2.5 shrink-0" strokeWidth={2.5} />
          {queued}
        </span>
      )}
      {running > 0 && (
        <span className="inline-flex items-center text-primary">
          <Loader2 className="size-2.5 shrink-0" strokeWidth={2.5} />
          {running}
        </span>
      )}
      {failed > 0 && (
        <span className="inline-flex items-center text-destructive">
          <AlertTriangle className="size-2.5 shrink-0" strokeWidth={2.5} />
          {failed}
        </span>
      )}
    </span>
  );
}
