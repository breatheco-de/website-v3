import { useCallback, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/** Thrown when staff back out of a duplicate warning: the editor stays open, no error toast. */
export class SaveCancelledError extends Error {
  constructor() {
    super("Save cancelled");
    this.name = "SaveCancelledError";
  }
}

type RefusalCode = "duplicate_link" | "rejected_link" | "redirect_link" | "similar_rows";

interface Refusal {
  error?: string;
  code: RefusalCode;
  existing_index?: number;
  existing?: { title: string | null; link: string | null; rejected: boolean };
  similar?: Array<{ index: number; title: string | null; link: string | null; rejected: boolean }>;
}

type Decision = "save_anyway" | "cancel" | "open_existing";

const CODES = new Set<RefusalCode>(["duplicate_link", "rejected_link", "redirect_link", "similar_rows"]);

const TITLES: Record<RefusalCode, string> = {
  duplicate_link: "This story is already in the list",
  rejected_link: "This story was rejected",
  redirect_link: "Use the publisher's link",
  similar_rows: "This may be the same story",
};

/**
 * Wraps an evidence-row save: on a duplicate refusal it asks staff what to do and, on Save anyway,
 * re-sends with `allow_duplicate=1`. Cancel throws SaveCancelledError.
 */
export function useEvidenceDuplicateGuard(opts: { onOpenExisting?: (storedIndex: number) => void } = {}) {
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const resolver = useRef<((d: Decision) => void) | null>(null);

  const decide = (d: Decision) => {
    resolver.current?.(d);
    resolver.current = null;
    setRefusal(null);
    setShowAdvanced(false);
  };

  const send = useCallback(
    async (request: (query: string) => Promise<Response>): Promise<Response> => {
      const res = await request("");
      if (res.status !== 409) return res;
      const body = (await res.clone().json().catch(() => null)) as Refusal | null;
      if (!body || !CODES.has(body.code)) return res;
      const decision = await new Promise<Decision>((resolve) => {
        resolver.current = resolve;
        setRefusal(body);
      });
      if (decision === "save_anyway") return request("?allow_duplicate=1");
      if (decision === "open_existing" && body.existing_index !== undefined) opts.onOpenExisting?.(body.existing_index);
      throw new SaveCancelledError();
    },
    [opts.onOpenExisting],
  );

  const canOverride = refusal !== null && refusal.code !== "redirect_link";
  const dialog = refusal ? (
    <Dialog open onOpenChange={(v) => { if (!v) decide("cancel"); }}>
      <DialogContent data-testid="dialog-evidence-duplicate">
        <DialogHeader>
          <DialogTitle>{TITLES[refusal.code]}</DialogTitle>
          <DialogDescription>{refusal.error}</DialogDescription>
        </DialogHeader>

        {refusal.code === "rejected_link" && (
          <p className="text-sm text-muted-foreground">
            Saving anyway adds it as a new, visible row. The rejected row stays hidden.
          </p>
        )}

        {refusal.code === "similar_rows" && refusal.similar && (
          <ul className="space-y-1.5 text-sm" data-testid="list-similar-rows">
            {refusal.similar.map((s) => (
              <li key={s.index} className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">{s.title || `Row ${s.index + 1}`}</span>
                  {s.rejected && (
                    <Badge variant="outline" className="text-[10px] font-normal">
                      Rejected
                    </Badge>
                  )}
                </div>
                {s.link && <div className="truncate text-xs text-muted-foreground">{s.link}</div>}
              </li>
            ))}
          </ul>
        )}

        <div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-duplicate-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
          </button>
          {showAdvanced && (
            <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <p>
                Links are compared by the page they point to: archive.org copies are unwrapped, and tracking
                parameters, AMP and mobile versions are ignored. The same link is allowed in another language only
                when both rows share a <code>translation_key</code>.
              </p>
              <p>
                "Looks like" compares titles (brand words ignored) and organization plus year, within the same
                language and kind. Saving past it records the match on the row; it shows next to Mark verified.
              </p>
              <p>
                News aggregator and short links (news.google.com, t.co, bit.ly, lnkd.in…) are always refused.
                Rejected rows stay in <code>db/&lt;database&gt;/&lt;file&gt;.yml</code> with a <code>_rejected</code>{" "}
                marker.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => decide("cancel")} data-testid="button-duplicate-cancel">
            Back to editing
          </Button>
          {refusal.existing_index !== undefined && opts.onOpenExisting && (
            <Button variant="outline" size="sm" onClick={() => decide("open_existing")} data-testid="button-duplicate-open-existing">
              Open existing row
            </Button>
          )}
          {canOverride && (
            <Button size="sm" onClick={() => decide("save_anyway")} data-testid="button-duplicate-save-anyway">
              Save anyway
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ) : null;

  return { dialog, send };
}
