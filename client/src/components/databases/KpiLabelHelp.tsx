import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** Databases page card label; click opens what the card means. Clicks never reach a clickable card behind it. */
export function KpiLabelHelp({ label, testId, children }: { label: string; testId: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
          onClick={(e) => e.stopPropagation()}
          data-testid={`button-kpi-help-${testId}`}
        >
          {label}
          <Info className="h-3 w-3 shrink-0" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 space-y-2 text-xs leading-relaxed text-muted-foreground"
        onClick={(e) => e.stopPropagation()}
        data-testid={`popover-kpi-help-${testId}`}
      >
        <p className="font-medium text-sm text-foreground">{label}</p>
        {children}
      </PopoverContent>
    </Popover>
  );
}
