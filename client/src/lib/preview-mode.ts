/**
 * Shareable staff preview viewport mode on /private/preview and public pages
 * (LLM crawler only on public). URL `preview_mode` wins over localStorage when
 * present. localStorage keeps the last mode so refresh still restores LLM/device
 * when the query param was dropped by an intermediate navigate.
 */

import {
  isPreviewDeviceId,
  type PreviewDeviceId,
} from "@/lib/preview-devices";
import { isPrivatePreviewPath, isVisualEditPath } from "@/lib/visual-edit-path";

export const PREVIEW_MODE_PARAM = "preview_mode";
export const PREVIEW_LOCATION_PARAM = "location";
export const PREVIEW_MODE_STORAGE_KEY = "4geeks_preview_mode";

/** sessionStorage: campus to restore when leaving LLM mode (same browser). */
export const LLM_STASHED_LOCATION_KEY = "4geeks_llm_stashed_location";

export type PreviewMode =
  | { kind: "desktop" }
  | { kind: "device"; deviceId: PreviewDeviceId }
  | { kind: "llm" };

/**
 * What the URL sync effect should do for the current path + `preview_mode`.
 * Public content pages only re-stamp / apply LLM; desktop and device stay
 * private-preview-only. Admin `/private/*` paths are ignored.
 */
export type PreviewUrlSyncDecision =
  | { action: "ignore" }
  | { action: "restamp-llm" }
  | { action: "apply-llm"; stripLocation: boolean }
  | { action: "apply-desktop" }
  | { action: "apply-device"; deviceId: PreviewDeviceId };

export function decidePreviewUrlSync(opts: {
  pathname: string;
  mode: PreviewMode | null;
  isLlmPreview: boolean;
}): PreviewUrlSyncDecision {
  const { pathname, mode, isLlmPreview } = opts;
  if (!isVisualEditPath(pathname)) return { action: "ignore" };

  const onPrivate = isPrivatePreviewPath(pathname);

  if (!onPrivate) {
    // Public content pages: LLM crawler preview only.
    if (mode?.kind === "llm") return { action: "apply-llm", stripLocation: true };
    if (!mode && isLlmPreview) return { action: "restamp-llm" };
    return { action: "ignore" };
  }

  if (!mode) {
    if (isLlmPreview) return { action: "restamp-llm" };
    return { action: "ignore" };
  }
  if (mode.kind === "llm") return { action: "apply-llm", stripLocation: true };
  if (mode.kind === "desktop") return { action: "apply-desktop" };
  return { action: "apply-device", deviceId: mode.deviceId };
}

export function parsePreviewModeParam(raw: string | null | undefined): PreviewMode | null {
  if (raw == null || raw === "") return null;
  const value = raw.trim().toLowerCase();
  if (value === "desktop") return { kind: "desktop" };
  if (value === "llm") return { kind: "llm" };
  if (isPreviewDeviceId(value)) return { kind: "device", deviceId: value };
  return null;
}

export function previewModeToParam(mode: PreviewMode): string {
  if (mode.kind === "desktop") return "desktop";
  if (mode.kind === "llm") return "llm";
  return mode.deviceId;
}

export function previewModeFromEditState(opts: {
  previewBreakpoint: "desktop" | "mobile";
  previewDeviceId: PreviewDeviceId;
  isLlmPreview: boolean;
}): PreviewMode {
  if (opts.isLlmPreview) return { kind: "llm" };
  if (opts.previewBreakpoint === "mobile") {
    return { kind: "device", deviceId: opts.previewDeviceId };
  }
  return { kind: "desktop" };
}

export function persistPreviewMode(mode: PreviewMode): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(PREVIEW_MODE_STORAGE_KEY, previewModeToParam(mode));
}

export function readStoredPreviewMode(): PreviewMode | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return parsePreviewModeParam(localStorage.getItem(PREVIEW_MODE_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function clearStoredPreviewMode(): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(PREVIEW_MODE_STORAGE_KEY);
}

/** Read mode from a search string (`?…` or bare query). Null = absent / invalid. */
export function readPreviewModeFromSearch(search: string): PreviewMode | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  try {
    return parsePreviewModeParam(new URLSearchParams(q).get(PREVIEW_MODE_PARAM));
  } catch {
    return null;
  }
}

export function stashLocationForLlm(locationSlug: string | null | undefined): void {
  if (typeof sessionStorage === "undefined") return;
  const trimmed = locationSlug?.trim();
  if (trimmed) {
    sessionStorage.setItem(LLM_STASHED_LOCATION_KEY, trimmed);
  } else {
    sessionStorage.removeItem(LLM_STASHED_LOCATION_KEY);
  }
}

export function takeStashedLocationForLlm(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  const value = sessionStorage.getItem(LLM_STASHED_LOCATION_KEY);
  sessionStorage.removeItem(LLM_STASHED_LOCATION_KEY);
  return value?.trim() || null;
}

export function peekStashedLocationForLlm(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem(LLM_STASHED_LOCATION_KEY)?.trim() || null;
}

/**
 * Build a shareable private-preview URL for the current page.
 * When mode is LLM, `location` is omitted even if present in the current search.
 */
export function buildShareablePreviewUrl(opts: {
  origin?: string;
  pathname: string;
  search: string;
  mode: PreviewMode;
}): string {
  const origin =
    opts.origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  const params = new URLSearchParams(
    opts.search.startsWith("?") ? opts.search.slice(1) : opts.search,
  );
  params.set(PREVIEW_MODE_PARAM, previewModeToParam(opts.mode));
  if (opts.mode.kind === "llm") {
    params.delete(PREVIEW_LOCATION_PARAM);
  }
  params.delete("device_embed");
  params.delete("hide_debug");
  params.delete("edit");
  params.delete("edit_mode");
  const qs = params.toString();
  return `${origin}${opts.pathname}${qs ? `?${qs}` : ""}`;
}

/** Apply preview_mode (+ optional location strip/restore) onto a URLSearchParams clone. */
export function applyPreviewModeToSearchParams(
  params: URLSearchParams,
  mode: PreviewMode,
  opts?: { stripLocationForLlm?: boolean },
): URLSearchParams {
  const next = new URLSearchParams(params);
  next.set(PREVIEW_MODE_PARAM, previewModeToParam(mode));
  if (mode.kind === "llm" && opts?.stripLocationForLlm !== false) {
    next.delete(PREVIEW_LOCATION_PARAM);
  }
  return next;
}
