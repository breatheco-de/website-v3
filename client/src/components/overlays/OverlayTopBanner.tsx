import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";
import type { Overlay } from "@/hooks/useOverlays";
import { markOverlaySeen, isOverlayDismissible } from "@/hooks/useOverlays";
import { OverlayActionButtons } from "./OverlayActionButtons";
import { OverlayContentImage, overlayHasImage } from "./OverlayContentImage";

interface OverlayTopBannerProps {
  overlay: Overlay;
  onDismiss: () => void;
}

export function OverlayTopBanner({ overlay, onDismiss }: OverlayTopBannerProps) {
  const { content } = overlay;
  const dismissible = isOverlayDismissible(overlay);

  function handleDismiss() {
    markOverlaySeen(overlay);
    onDismiss();
  }

  const banner = (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] bg-primary text-primary-foreground px-4 py-2 flex items-center gap-3 shadow-md"
      data-testid="overlay-top-banner"
    >
      {overlayHasImage(content) && (
        <div className="h-10 w-auto shrink-0 rounded overflow-hidden bg-primary-foreground/10">
          <OverlayContentImage content={content} className="h-10 w-auto object-contain" />
        </div>
      )}
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2">
        {content.title && (
          <span className="font-semibold text-sm">{content.title}</span>
        )}
        {content.body && (
          <span className="text-sm opacity-90">{content.body}</span>
        )}
        <OverlayActionButtons
          buttons={content.buttons}
          onDismiss={handleDismiss}
          size="sm"
          className="shrink-0"
          buttonClassName="shrink-0"
          defaultVariant="secondary"
        />
      </div>
      {dismissible && (
        <Button
          size="icon"
          variant="ghost"
          onClick={handleDismiss}
          aria-label="Dismiss banner"
          data-testid="button-dismiss-banner"
        >
          <IconX size={16} />
        </Button>
      )}
    </div>
  );

  return createPortal(banner, document.body);
}
