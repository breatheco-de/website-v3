import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface SharedLayoutExplainDialogProps {
  open: boolean;
  onClose: () => void;
  /** When true, shared layout is mandatory (DB-backed types). */
  alwaysOn?: boolean;
}

export function SharedLayoutExplainDialog({
  open,
  onClose,
  alwaysOn = false,
}: SharedLayoutExplainDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>How shared layout works</DialogTitle>
          <DialogDescription>
            {alwaysOn
              ? "This content type always uses a shared layout (database-backed entries)."
              : "When single template is on, every entry shares one section structure across locales."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong className="text-foreground">Structure lives in locale templates.</strong>{" "}
            Each <code className="text-xs">template.&#123;locale&#125;.yml</code> holds the full
            section list (legacy <code className="text-xs">single.*</code> still loads).{" "}
            <code className="text-xs">_common.template.yml</code> is layout defaults
            only (no sections). Type <code className="text-xs">_common.yml</code> must not contain
            sections either.
          </p>
          <p>
            <strong className="text-foreground">What stays in sync:</strong> add / delete / reorder,
            and generic layout keys including visibility (<code className="text-xs">showOn*</code>).
            Hiding a section on the type single hides it for every locale.
          </p>
          <p>
            <strong className="text-foreground">What does not auto-sync:</strong> titles, CTAs,
            images, and other component props. Changing{" "}
            <code className="text-xs">type</code> / <code className="text-xs">version</code> /{" "}
            <code className="text-xs">variant</code> warns you to update sibling locales manually.
          </p>
          <p>
            <strong className="text-foreground">New sections:</strong> mirrored to sibling locale
            singles. Locales that still need copy get a needs-edit label and stay hidden from the
            public until staff finish them.
          </p>
          <p>
            <strong className="text-foreground">Raw YAML / MCP:</strong> raw editing skips automatic
            sync (you already see a warning). MCP agents should follow structured next actions to
            update sibling singles themselves.
          </p>
          <p>
            <strong className="text-foreground">Entry overlays:</strong> one article can still
            override or hide a shared section via id-based patches without changing the template.
          </p>
          <p>
            <strong className="text-foreground">Section bindings:</strong> bindings cannot be used
            on shared-layout types. Enabling shared layout removes any existing bindings for that
            content type.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={onClose} data-testid="button-shared-layout-explain-close">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
