import { useState } from "react";
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

interface LinkedDatabaseExplainDialogProps {
  open: boolean;
  onClose: () => void;
  /** Database slug when already linked (for path examples). */
  databaseSlug?: string | null;
}

export function LinkedDatabaseExplainDialog({
  open,
  onClose,
  databaseSlug = null,
}: LinkedDatabaseExplainDialogProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const slugExample = databaseSlug || "{slug}";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setShowAdvanced(false);
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How linked databases work</DialogTitle>
          <DialogDescription>
            A content type can pull entries from an external database instead of only static YAML
            files.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">The link is a slug.</strong> In{" "}
            <code className="text-xs">content-types.yml</code>,{" "}
            <code className="text-xs">database.slug</code> points at a database folder under{" "}
            <code className="text-xs">db/</code>. That is the only connection field on the content
            type.
          </p>
          <p>
            <strong className="text-foreground">Field mapping</strong> maps content-type concepts
            (slug, locale, title, …) onto database columns.{" "}
            <code className="text-xs">_slug</code> is required while a database is linked.
          </p>
          <p>
            <strong className="text-foreground">Shared layout stays on.</strong> Database-backed
            types always use a single template; you cannot turn shared layout off while linked.
          </p>
          <p>
            <strong className="text-foreground">Cache powers lists and SEO.</strong> Entries are
            fetched into a local cache. Clear cache (or wait for TTL) to refresh. Until cache
            exists, list/SEO views may look empty even though the database is connected.
          </p>
          <p>
            <strong className="text-foreground">Static YAML still matters.</strong> Partial
            overrides and the shared template shell live on disk; the database supplies the entry
            data on top.
          </p>

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-linked-database-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>

          {showAdvanced && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
              <div>
                <p className="font-medium text-foreground mb-1">Key files</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Content type link:{" "}
                    <code className="text-[11px] font-mono">site_*/content-types.yml</code> →{" "}
                    <code className="text-[11px] font-mono">database.slug</code>
                  </li>
                  <li>
                    Database config:{" "}
                    <code className="text-[11px] font-mono">
                      site_*/db/{slugExample}/config.yml
                    </code>
                  </li>
                  <li>
                    Link helpers:{" "}
                    <code className="text-[11px] font-mono">server/content-types.ts</code>
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">APIs</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Cache metrics on this card:{" "}
                    <code className="text-[11px] font-mono">
                      GET /api/content-types/:type/cache-status
                    </code>
                  </li>
                  <li>
                    Manage / clear / convert: content-type config and clear-cache routes under{" "}
                    <code className="text-[11px] font-mono">/api/content-types/:type</code>
                  </li>
                </ul>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose} data-testid="button-linked-database-explain-close">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
