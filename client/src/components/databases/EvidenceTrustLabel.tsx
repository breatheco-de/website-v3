import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const COPY = {
  trusted: {
    label: "Trusted",
    body: [
      "This row was added before we started tracking who changes evidence, and no agent has changed its link or claim since.",
      "Proposals can use it as proof. There is nothing to verify.",
    ],
  },
  verified: {
    label: "Verified",
    body: [
      "A staff member last changed this row's link or claim, or confirmed an agent's change with Mark verified.",
      "Proposals can use it as proof. If an agent changes the link or claim again, it goes back to not verified until someone checks it.",
    ],
  },
} as const;

/** Proof column label for rows that already count as proof, with a click-to-open explanation. */
export function EvidenceTrustLabel({ trust, testId }: { trust: "trusted" | "verified"; testId: string }) {
  const copy = COPY[trust];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          data-testid={`button-evidence-${trust}-${testId}`}
        >
          {copy.label}
          <Info className="h-3 w-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 space-y-2 text-xs leading-relaxed text-muted-foreground"
        data-testid={`popover-evidence-${trust}-${testId}`}
      >
        <p className="font-medium text-sm text-foreground">{copy.label}</p>
        {copy.body.map((p) => (
          <p key={p}>{p}</p>
        ))}
      </PopoverContent>
    </Popover>
  );
}
