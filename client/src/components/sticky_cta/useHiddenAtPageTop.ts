import { useEffect, useState } from "react";

/** Scroll past this many px before the sticky bar may show when `show_at_top` is false. */
export const STICKY_TOP_SCROLL_PX = 48;

function resolveShowAtTop(value: boolean | string | undefined | null): boolean {
  if (value === true || value === "true") return true;
  return false;
}

/**
 * When `show_at_top` is false/omitted (default), the sticky bar stays hidden until the page
 * has scrolled past {@link STICKY_TOP_SCROLL_PX}. Independent of hero presence.
 */
export function useHiddenAtPageTop(showAtTop: boolean | string | undefined | null): boolean {
  const allowAtTop = resolveShowAtTop(showAtTop);
  const [hidden, setHidden] = useState(() => {
    if (allowAtTop || typeof window === "undefined") return false;
    return window.scrollY < STICKY_TOP_SCROLL_PX;
  });

  useEffect(() => {
    if (allowAtTop) {
      setHidden(false);
      return;
    }
    const update = () => setHidden(window.scrollY < STICKY_TOP_SCROLL_PX);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [allowAtTop]);

  return hidden;
}
