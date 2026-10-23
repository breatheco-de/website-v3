import type { ReactNode } from "react";
import { IconAlertTriangle, IconInfoCircle, IconX } from "@tabler/icons-react";
import { cn } from "@/lib/utils";
import type { SplitHealthLocale } from "../types";

export function AbTrafficNotice({
  tone,
  testId,
  children,
}: {
  tone: "warning" | "destructive";
  testId: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mb-2 flex gap-1.5 rounded-md border px-2 py-1.5 text-xs leading-snug",
        tone === "destructive"
          ? "border-destructive/40 bg-destructive/10 text-foreground"
          : "border-status-away/40 bg-status-away/10 text-foreground",
      )}
      data-testid={testId}
    >
      <IconAlertTriangle
        className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", tone === "destructive" ? "text-destructive" : "text-status-away")}
      />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

/** Shown instead of the sliders when A/B testing is not set up and nothing has traffic. */
export function AbTestingNotSetUpNotice({ locale, onClose }: { locale: string; onClose: () => void }) {
  return (
    <div
      className="mb-2 rounded-md border border-border bg-muted/40 px-2 py-2 text-xs leading-snug text-foreground"
      data-testid={`notice-ab-not-setup-${locale}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">A/B testing has not been set up yet</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Close"
          data-testid={`button-close-ab-notice-${locale}`}
        >
          <IconX className="h-3 w-3" />
        </button>
      </div>
      <p className="mt-1 text-muted-foreground">
        Until it is, every visitor sees Default and versions can't get traffic. Setup runs a quick check that
        visitors get the version they are counted under.
      </p>
      <a
        href="/private/settings/ab-testing/setup"
        className="mt-1.5 inline-block font-medium text-primary underline underline-offset-2"
        data-testid={`link-ab-setup-${locale}`}
      >
        Set up A/B testing
      </a>
    </div>
  );
}

/** Read more (advanced) for the stickiness warning. */
export function AbStickyAdvanced() {
  return (
    <details className="text-muted-foreground">
      <summary className="cursor-pointer select-none">Read more (advanced)</summary>
      <ul className="mt-1 list-disc space-y-0.5 pl-4">
        <li>Visitors on Default are counted as their own group, so results compare every version with Default.</li>
        <li>Staff, bots, and forced previews are never put in a test or counted.</li>
        <li>Leads are credited to the first test a visitor saw in their visit (30 minutes, across tabs).</li>
        <li>Each test run starts on its start date; starting a test again later is a new run with a fresh split.</li>
      </ul>
    </details>
  );
}

function pctLine(pct: Record<string, number>): string {
  return Object.entries(pct)
    .sort(([a], [b]) => (a === "default" ? -1 : b === "default" ? 1 : a.localeCompare(b)))
    .map(([k, v]) => `${k === "default" ? "Default" : k} ${Math.round(v)}%`)
    .join(" / ");
}

/** Live split check (sample ratio mismatch) warning for a locale. */
export function SplitMismatchNotice({ health, locale }: { health: SplitHealthLocale; locale: string }) {
  const source = health.server.status === "mismatch" ? health.server : health.ga4;
  const sourceLabel = health.server.status === "mismatch" ? "server counts" : "Google Analytics";
  return (
    <AbTrafficNotice tone="destructive" testId={`notice-split-mismatch-${locale}`}>
      <p>
        Results are unreliable: set to {pctLine(health.expected_pct)}, visitors are seeing{" "}
        {pctLine(source.observed_pct)}. Check caching or tracking before trusting this test.
      </p>
      <details className="text-muted-foreground">
        <summary className="cursor-pointer select-none">
          <IconInfoCircle className="mr-0.5 inline h-3 w-3" />
          Read more (advanced)
        </summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Source: {sourceLabel} ({source.total} {health.server.status === "mismatch" ? "visitors" : "sessions"}).</li>
          <li>
            Chi-square p = {source.p_value != null ? source.p_value.toExponential(1) : "n/a"} (flagged below 0.001,
            judged after 200).
          </li>
          {health.ga4.through_date && <li>Google Analytics numbers run through {health.ga4.through_date}.</li>}
          <li>Experiment id: {health.experiment_id}</li>
        </ul>
      </details>
    </AbTrafficNotice>
  );
}
