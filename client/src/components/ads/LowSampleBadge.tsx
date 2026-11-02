import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CHIP_BUTTON_CLASS } from "./UrlChangedBadge";

/** "not enough data" chip on a paid page or campaign row; click explains why its rates are greyed out. */
export function LowSampleBadge({
  subject = "page",
  minVisits,
  testId = "chip-low-sample",
}: {
  subject?: "page" | "campaign";
  minVisits?: number;
  testId?: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className={CHIP_BUTTON_CLASS} aria-label='What does "not enough data" mean?' data-testid={testId}>
          not enough data
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p className="text-sm font-medium text-foreground">Not enough data</p>
        <p>
          This {subject} had {minVisits ? `fewer than ${minVisits}` : "too few"} paid visits in this date range, so its rates (cost per visit,
          conversion rate, cost per lead, bounce) are greyed out. One or two visits or leads either way would swing them a lot, so don&apos;t compare
          them with other {subject}s yet.
        </p>
        <p>Totals like spend, paid visits and leads are still exact. Widen the date range or wait for more traffic.</p>
        <p>The minimum is set in Settings → Meta Ads, under alert thresholds.</p>
      </PopoverContent>
    </Popover>
  );
}
