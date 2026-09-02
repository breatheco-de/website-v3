/** Minimal overlay shape for save validation (client + server). */
export interface OverlaySaveCheck {
  id?: string;
  enabled?: boolean;
  dismissible?: boolean;
  content?: {
    title?: string;
    body?: string;
    buttons?: Array<{ label?: string; variant?: string; href?: string }>;
    image_id?: string;
    image_url?: string;
  };
  trigger?: unknown;
  targeting?: unknown;
  frequency?: unknown;
  component?: unknown;
}

export type OverlayContentSlice = NonNullable<OverlaySaveCheck["content"]>;

export type OverlayConfigSlice = {
  enabled: boolean;
  trigger: unknown;
  targeting: unknown;
  frequency: unknown;
  component: unknown;
  dismissible?: boolean;
};

export function overlayHasLabeledButton(overlay: OverlaySaveCheck): boolean {
  return (overlay.content?.buttons ?? []).some(
    (b) => typeof b?.label === "string" && b.label.trim().length > 0,
  );
}

/** True when soft-dismiss is allowed (default). */
export function isOverlayDismissible(overlay: { dismissible?: boolean }): boolean {
  return overlay.dismissible !== false;
}

/** True when the overlay is live for visitors (default true if omitted). */
export function isOverlayEnabled(overlay: { enabled?: boolean }): boolean {
  return overlay.enabled !== false;
}

/**
 * Blocking overlays (`dismissible: false`) that are **enabled** require at least
 * one labeled button so visitors can dismiss. Disabled blocking overlays are OK.
 * Returns an error message or null if valid.
 */
export function overlayBlockingSaveError(overlay: OverlaySaveCheck): string | null {
  if (!isOverlayEnabled(overlay)) return null;
  if (isOverlayDismissible(overlay)) return null;
  if (overlayHasLabeledButton(overlay)) return null;
  const id = overlay.id?.trim() || "overlay";
  return `Blocking overlay "${id}" needs at least one button with a label before it can be enabled.`;
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

export function overlayContentSlice(overlay: OverlaySaveCheck): OverlayContentSlice {
  const c = overlay.content ?? {};
  return {
    title: typeof c.title === "string" ? c.title : "",
    body: typeof c.body === "string" ? c.body : "",
    buttons: Array.isArray(c.buttons) ? c.buttons : [],
    ...(c.image_id !== undefined ? { image_id: c.image_id } : {}),
    ...(c.image_url !== undefined ? { image_url: c.image_url } : {}),
  };
}

export function overlayConfigSlice(overlay: OverlaySaveCheck): OverlayConfigSlice {
  return {
    enabled: isOverlayEnabled(overlay),
    trigger: overlay.trigger ?? { event: "page_load", delay: 0 },
    targeting: overlay.targeting ?? { pages: "all", geo: {} },
    frequency: overlay.frequency ?? "once",
    component: overlay.component ?? "modal",
    ...(overlay.dismissible !== undefined ? { dismissible: overlay.dismissible } : {}),
  };
}

/** Merge a content payload onto an existing overlay (config untouched). */
export function mergeOverlayContent(
  existing: OverlaySaveCheck,
  content: OverlayContentSlice,
): OverlaySaveCheck {
  return {
    ...existing,
    content: overlayContentSlice({ content }),
  };
}

/**
 * Merge a config payload onto an existing overlay (content untouched).
 * Does not accept or apply `content`.
 */
export function mergeOverlayConfig(
  existing: OverlaySaveCheck,
  config: Partial<OverlayConfigSlice> & { content?: unknown },
): { ok: true; overlay: OverlaySaveCheck } | { ok: false; error: string } {
  if ("content" in config && config.content !== undefined) {
    return {
      ok: false,
      error: "Config updates must not include content; use the content endpoint instead",
    };
  }
  const next: OverlaySaveCheck = {
    ...existing,
    enabled: config.enabled !== undefined ? config.enabled : isOverlayEnabled(existing),
    trigger: config.trigger !== undefined ? config.trigger : existing.trigger,
    targeting: config.targeting !== undefined ? config.targeting : existing.targeting,
    frequency: config.frequency !== undefined ? config.frequency : existing.frequency,
    component: config.component !== undefined ? config.component : existing.component,
  };
  if (config.dismissible !== undefined) {
    next.dismissible = config.dismissible;
  } else if (existing.dismissible !== undefined) {
    next.dismissible = existing.dismissible;
  }
  return { ok: true, overlay: next };
}

/** Normalize a create body: force enabled false unless explicitly allowed and valid. */
export function normalizeNewOverlay(
  body: OverlaySaveCheck,
  opts?: { forceDisabled?: boolean },
): OverlaySaveCheck {
  const forceDisabled = opts?.forceDisabled !== false;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  return {
    id,
    enabled: forceDisabled ? false : isOverlayEnabled(body),
    trigger: body.trigger ?? { event: "page_load", delay: 0 },
    targeting: body.targeting ?? { pages: "all", geo: {} },
    frequency: body.frequency ?? "once",
    component: body.component ?? "modal",
    ...(body.dismissible !== undefined ? { dismissible: body.dismissible } : {}),
    content: overlayContentSlice(body),
  };
}

export function asOverlaysList(data: unknown): OverlaySaveCheck[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const overlays = (data as { overlays?: unknown }).overlays;
  if (!Array.isArray(overlays)) return [];
  return overlays.filter((o): o is OverlaySaveCheck => !!o && typeof o === "object");
}
