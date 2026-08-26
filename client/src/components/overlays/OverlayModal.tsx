import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import type { Overlay } from "@/hooks/useOverlays";
import { markOverlaySeen, isOverlayDismissible } from "@/hooks/useOverlays";
import { OverlayActionButtons } from "./OverlayActionButtons";
import { OverlayContentImage, overlayHasImage } from "./OverlayContentImage";

interface OverlayModalProps {
  overlay: Overlay;
  onDismiss: () => void;
}

export function OverlayModal({ overlay, onDismiss }: OverlayModalProps) {
  const { content } = overlay;
  const dismissible = isOverlayDismissible(overlay);

  function handleDismiss() {
    markOverlaySeen(overlay);
    onDismiss();
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && dismissible) handleDismiss();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        hideClose={!dismissible}
        onPointerDownOutside={dismissible ? undefined : (e) => e.preventDefault()}
        onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
        onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
      >
        {overlayHasImage(content) && (
          <div className="rounded-md overflow-hidden mb-2">
            <OverlayContentImage content={content} className="w-full object-cover max-h-48" />
          </div>
        )}
        <DialogHeader>
          <DialogTitle>{content.title}</DialogTitle>
          {content.body && (
            <DialogDescription>{content.body}</DialogDescription>
          )}
        </DialogHeader>
        <OverlayActionButtons
          buttons={content.buttons}
          onDismiss={handleDismiss}
          size="sm"
          className="justify-end pt-2"
        />
      </DialogContent>
    </Dialog>
  );
}
