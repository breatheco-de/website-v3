import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  SOURCE_LABELS,
  samplesForIssue,
  type RuntimeHitSample,
  type RuntimeSourceTag,
} from "@shared/runtime-issues";

function sourceLabel(source: string | undefined): string {
  if (!source) return "Before sampling";
  return SOURCE_LABELS[source as RuntimeSourceTag] ?? source;
}

function formatSampleTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function RuntimeIssueRecentSamples({
  fingerprint,
  samples,
  recent,
  windowCount,
}: {
  fingerprint: string;
  samples?: RuntimeHitSample[];
  recent?: RuntimeHitSample[];
  windowCount: number;
}) {
  const rows = samplesForIssue({ fingerprint, samples }, recent);
  const emptyWithHits = rows.length === 0 && windowCount > 0;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer"
          data-testid={`badge-runtime-recent-samples-${fingerprint}`}
        >
          <Badge variant="outline" className="text-[10px]">
            samples ({rows.length})
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-96 space-y-2 text-sm"
        data-testid={`popover-runtime-recent-samples-${fingerprint}`}
      >
        <p className="font-medium text-foreground">Recent samples</p>
        <p className="text-xs text-muted-foreground">
          Last hits we stored for this path (not the full history). Preview = crawler fetch; Person =
          browser; the same click hash on different days usually means a shared or reused link, not a
          fresh ad click.
        </p>
        {emptyWithHits ? (
          <p className="text-xs text-muted-foreground" data-testid="text-samples-empty-with-count">
            No samples left in the last hits we kept site-wide. Use the people / preview breakdown on
            the row instead.
          </p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">No samples yet for this path.</p>
        ) : (
          <ul className="space-y-2 max-h-56 overflow-y-auto">
            {rows
              .slice()
              .reverse()
              .map((row, i) => (
                <li
                  key={`${row.ts}-${i}`}
                  className="rounded border border-border px-2 py-1.5 text-xs space-y-0.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline" className="text-[10px] font-normal">
                      {sourceLabel(row.source)}
                    </Badge>
                    <span className="text-muted-foreground">{formatSampleTime(row.ts)}</span>
                  </div>
                  {row.referrerHost ? (
                    <p className="text-muted-foreground">From {row.referrerHost}</p>
                  ) : row.referrer ? (
                    <p className="text-muted-foreground truncate" title={row.referrer}>
                      {row.referrer}
                    </p>
                  ) : null}
                  {row.click ? (
                    <p className="font-mono text-muted-foreground">
                      {row.click.kind}#{row.click.hash}
                    </p>
                  ) : null}
                  {!row.source && !row.click ? (
                    <p className="text-muted-foreground italic">Before sampling</p>
                  ) : null}
                </li>
              ))}
          </ul>
        )}
        <p className="text-[10px] text-muted-foreground">
          Advanced: click ids are stored as a short hash only; enriched samples start after deploy.
          Older rows pulled from production may only show a referrer.
        </p>
      </PopoverContent>
    </Popover>
  );
}
