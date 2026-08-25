/** Minimal overlay shape for save validation (client + server). */
export interface OverlaySaveCheck {
  id?: string;
  dismissible?: boolean;
  content?: {
    buttons?: Array<{ label?: string }>;
  };
}

export function overlayHasLabeledButton(overlay: OverlaySaveCheck): boolean {
  return (overlay.content?.buttons ?? []).some(
    (b) => typeof b?.label === "string" && b.label.trim().length > 0,
  );
}

/** True when soft-dismiss is allowed (default). */
export function isOverlayDismissible(overlay: { dismissible?: boolean }): boolean {
  return overlay.dismissible !== false;
}

/**
 * Blocking overlays (`dismissible: false`) require at least one labeled button
 * so visitors can dismiss. Returns an error message or null if valid.
 */
export function overlayBlockingSaveError(overlay: OverlaySaveCheck): string | null {
  if (isOverlayDismissible(overlay)) return null;
  if (overlayHasLabeledButton(overlay)) return null;
  const id = overlay.id?.trim() || "overlay";
  return `Blocking overlay "${id}" needs at least one button with a label so visitors can dismiss it.`;
}

export function validateOverlaysConfig(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return "overlays.yml must be a YAML object (e.g. overlays: [])";
  }
  const overlays = (data as { overlays?: unknown }).overlays;
  if (overlays === undefined) return null;
  if (!Array.isArray(overlays)) {
    return "overlays must be an array";
  }
  for (const item of overlays) {
    if (!item || typeof item !== "object") continue;
    const err = overlayBlockingSaveError(item as OverlaySaveCheck);
    if (err) return err;
  }
  return null;
}
