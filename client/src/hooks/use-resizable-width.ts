import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";

type Options = {
  storageKey: string;
  defaultWidth: number;
  minWidth: number;
  /** Largest width as a share of the window width. */
  maxRatio: number;
  /** Width change per arrow key press. */
  keyboardStep?: number;
};

/**
 * Width for a panel docked to the right edge, resized by dragging its left edge.
 * Dragging left widens the panel. Saved per browser tab in sessionStorage.
 */
export function useResizableWidth({ storageKey, defaultWidth, minWidth, maxRatio, keyboardStep = 32 }: Options) {
  const maxWidth = useCallback(
    () => (typeof window === "undefined" ? defaultWidth : Math.max(minWidth, Math.floor(window.innerWidth * maxRatio))),
    [defaultWidth, minWidth, maxRatio],
  );
  const clamp = useCallback((w: number) => Math.round(Math.max(minWidth, Math.min(maxWidth(), w))), [minWidth, maxWidth]);

  const [width, setWidth] = useState(() => {
    if (typeof window === "undefined") return defaultWidth;
    try {
      const parsed = parseInt(sessionStorage.getItem(storageKey) ?? "", 10);
      if (!isNaN(parsed)) return clamp(parsed);
    } catch {}
    return clamp(defaultWidth);
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, String(width));
    } catch {}
  }, [storageKey, width]);

  useEffect(() => {
    const onResize = () => setWidth((w) => clamp(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [clamp]);

  const drag = useRef<{ startX: number; startWidth: number; pending: number; frame: number } | null>(null);

  const endDrag = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    if (d.frame) cancelAnimationFrame(d.frame);
    setWidth(d.pending);
    drag.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => endDrag, [endDrag]);

  const reset = useCallback(() => setWidth(clamp(defaultWidth)), [clamp, defaultWidth]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.clientX, startWidth: width, pending: width, frame: 0 };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    d.pending = clamp(d.startWidth + d.startX - e.clientX);
    if (!d.frame) {
      d.frame = requestAnimationFrame(() => {
        d.frame = 0;
        setWidth(d.pending);
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    endDrag();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === "ArrowLeft") setWidth((w) => clamp(w + keyboardStep));
    else if (e.key === "ArrowRight") setWidth((w) => clamp(w - keyboardStep));
    else if (e.key === "Enter") reset();
    else return;
    e.preventDefault();
  };

  return {
    width,
    reset,
    handleProps: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-orientation": "vertical" as const,
      "aria-valuenow": width,
      "aria-valuemin": minWidth,
      "aria-valuemax": maxWidth(),
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
      onKeyDown,
      onDoubleClick: reset,
    },
  };
}
