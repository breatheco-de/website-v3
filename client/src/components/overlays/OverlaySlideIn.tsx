import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";
import type { Overlay } from "@/hooks/useOverlays";
import { markOverlaySeen, isOverlayDismissible } from "@/hooks/useOverlays";
import { UniversalImage } from "@/components/UniversalImage";
import { OverlayActionButtons } from "./OverlayActionButtons";

interface OverlaySlideInProps {
  overlay: Overlay;
  onDismiss: () => void;
}

export function OverlaySlideIn({ overlay, onDismiss }: OverlaySlideInProps) {
  const { content } = overlay;
  const dismissible = isOverlayDismissible(overlay);

  function handleDismiss() {
    markOverlaySeen(overlay);
    onDismiss();
  }

  const hasButtons = (content.buttons ?? []).some((b) => b.label);

  const panel = (
    <div
      className="fixed bottom-4 right-4 z-[9999] w-80 animate-in slide-in-from-bottom-4 duration-300"
      data-testid="overlay-slide-in"
    >
      <Card className="shadow-lg">
        {content.image_id && (
          <div className="rounded-t-lg overflow-hidden">
            <UniversalImage
              id={content.image_id}
              alt={content.title}
              className="w-full object-cover max-h-36"
            />
          </div>
        )}
        <CardHeader className="pb-2 flex flex-row items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{content.title}</CardTitle>
          {dismissible && (
            <Button
              size="icon"
              variant="ghost"
              onClick={handleDismiss}
              aria-label="Close"
              data-testid="button-dismiss-slide-in"
            >
              <IconX size={16} />
            </Button>
          )}
        </CardHeader>
        {content.body && (
          <CardContent className="pt-0 pb-3">
            <p className="text-sm text-muted-foreground">{content.body}</p>
          </CardContent>
        )}
        {hasButtons && (
          <CardContent className="pt-0 pb-4">
            <OverlayActionButtons
              buttons={content.buttons}
              onDismiss={handleDismiss}
              buttonClassName="flex-1"
            />
          </CardContent>
        )}
      </Card>
    </div>
  );

  return createPortal(panel, document.body);
}
