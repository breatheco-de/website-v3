import React from "react";
import { Button } from "@/components/ui/button";
import { InternalLink } from "@/components/InternalLink";
import type { OverlayButton } from "@/hooks/useOverlays";
import { cn } from "@/lib/utils";

interface OverlayActionButtonsProps {
  buttons?: OverlayButton[];
  onDismiss: () => void;
  size?: "sm" | "default";
  className?: string;
  buttonClassName?: string;
  defaultVariant?: OverlayButton["variant"];
}

/** Renders overlay CTAs. Empty href = dismiss-only (close without navigating). */
export function OverlayActionButtons({
  buttons,
  onDismiss,
  size = "sm",
  className,
  buttonClassName,
  defaultVariant = "default",
}: OverlayActionButtonsProps) {
  const visible = (buttons ?? []).filter((b) => b.label);
  if (visible.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {visible.map((btn, i) =>
        btn.href ? (
          <Button
            key={i}
            variant={btn.variant ?? defaultVariant}
            size={size}
            asChild
            className={buttonClassName}
          >
            <InternalLink
              href={btn.href}
              onNavigate={onDismiss}
              onClick={onDismiss}
              target="_self"
              data-testid={`overlay-button-link-${i}`}
            >
              {btn.label}
            </InternalLink>
          </Button>
        ) : (
          <Button
            key={i}
            variant={btn.variant ?? defaultVariant}
            size={size}
            className={buttonClassName}
            onClick={onDismiss}
            data-testid={`overlay-button-dismiss-${i}`}
          >
            {btn.label}
          </Button>
        ),
      )}
    </div>
  );
}
