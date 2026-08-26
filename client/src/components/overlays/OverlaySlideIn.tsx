import { createPortal } from "react-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IconX } from "@tabler/icons-react";
import type { Overlay } from "@/hooks/useOverlays";
import { markOverlaySeen, isOverlayDismissible } from "@/hooks/useOverlays";
import { OverlayActionButtons } from "./OverlayActionButtons";
import { OverlayContentImage, overlayHasImage } from "./OverlayContentImage";

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
      <Card className="shadow-lg overflow-hidden">
        <div className="relative px-5 pt-4">
          {dismissible && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Close"
              data-testid="button-dismiss-slide-in"
              className="absolute top-3 right-3 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <IconX size={16} />
            </button>
          )}

          {overlayHasImage(content) && (
            <div className={dismissible ? "pt-2 pr-6" : ""}>
              <OverlayContentImage
                content={content}
                className="mx-auto h-12 w-auto object-contain"
              />
            </div>
          )}
        </div>

        <CardHeader className="px-5 pb-2 pt-3">
          <CardTitle className="text-base leading-snug text-center">
            {content.title}
          </CardTitle>
        </CardHeader>

        {content.body && (
          <CardContent className="px-5 pt-0 pb-3">
            <p className="text-sm text-muted-foreground leading-relaxed text-center">
              {content.body}
            </p>
          </CardContent>
        )}

        {hasButtons && (
          <CardContent className="px-5 pt-0 pb-3">
            <OverlayActionButtons
              buttons={content.buttons}
              onDismiss={handleDismiss}
              buttonClassName="flex-1"
            />
          </CardContent>
        )}

        {dismissible && (
          <CardContent className="px-5 pt-0 pb-4 flex justify-center">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDismiss}
              className="h-8 min-w-[7rem] px-6 text-xs"
              data-testid="button-dismiss-slide-in-bottom"
            >
              Close
            </Button>
          </CardContent>
        )}
      </Card>
    </div>
  );

  return createPortal(panel, document.body);
}
