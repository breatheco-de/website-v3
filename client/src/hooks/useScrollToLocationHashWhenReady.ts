import { useEffect } from "react";

/**
 * Wake DeferredSection via `scrollToSection`, then scrollIntoView.
 *
 * - Same-page (`useInternalNav`): one `smooth` scroll after 2 rAF.
 * - Page arrival with hash: wait for layout to settle, then one `auto` jump.
 */

const LAYOUT_STABLE_FRAMES = 8;

export type ScrollToSectionWhenReadyOptions = {
  /** Stop waiting for the node after this many ms. Default 5000. */
  maxMs?: number;
  behavior?: ScrollBehavior;
};

export type ScrollToLocationHashWhenReadyOptions = {
  /** Max ms to wait for node + layout settle. Default 5000. */
  maxMs?: number;
};

/** Element id from `location.hash` (`#id` or dirty `#id?query`). */
export function parseLocationHashSectionId(
  hash = typeof window !== "undefined" ? window.location.hash : "",
): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return "";
  return raw.split("?")[0] || "";
}

function wakeDeferredSectionsForTarget(targetId: string): void {
  window.dispatchEvent(new CustomEvent("scrollToSection", { detail: { targetId } }));
}

function scrollElementIntoView(id: string, behavior: ScrollBehavior): void {
  document.getElementById(id)?.scrollIntoView({ behavior, block: "start" });
}

/** Same-page path: wake + one scroll after 2 rAF. */
function scrollOnce(id: string, behavior: ScrollBehavior): void {
  wakeDeferredSectionsForTarget(id);
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      scrollElementIntoView(id, behavior);
    });
  });
}

/**
 * Cross-page arrival: wake deferred, wait until document height stabilizes,
 * then a single auto jump (no follow-up re-align).
 */
function alignLocationHashAfterDeferredLayout(
  id: string,
  options?: { maxSettleMs?: number },
): () => void {
  const maxSettleMs = options?.maxSettleMs ?? 5000;
  let cancelled = false;
  let pollRaf = 0;
  let completed = false;

  const cleanup = () => {
    cancelled = true;
    if (pollRaf) cancelAnimationFrame(pollRaf);
    pollRaf = 0;
  };

  const finish = () => {
    if (completed) return;
    completed = true;
    cleanup();
  };

  wakeDeferredSectionsForTarget(id);

  let lastHeight = 0;
  let stableFrames = 0;
  const settleStarted = performance.now();

  const pageHeight = () =>
    Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);

  const finishAlign = () => {
    if (cancelled || completed) return;
    scrollElementIntoView(id, "auto");
    finish();
  };

  const settleTick = () => {
    if (cancelled || completed) return;
    wakeDeferredSectionsForTarget(id);

    const h = pageHeight();
    if (h === lastHeight) {
      stableFrames += 1;
    } else {
      lastHeight = h;
      stableFrames = 0;
    }

    if (stableFrames >= LAYOUT_STABLE_FRAMES || performance.now() - settleStarted >= maxSettleMs) {
      finishAlign();
      return;
    }

    pollRaf = requestAnimationFrame(settleTick);
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (cancelled) return;
      lastHeight = pageHeight();
      pollRaf = requestAnimationFrame(settleTick);
    });
  });

  return () => {
    cleanup();
    finish();
  };
}

function waitForSectionId(
  id: string,
  maxMs: number,
  onFound: () => void,
  onGiveUp?: () => void,
): () => void {
  if (document.getElementById(id)) {
    onFound();
    return () => {};
  }

  let cancelled = false;
  const startedAt = performance.now();
  let mutationObserver: MutationObserver | null = null;
  let pollRaf = 0;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    cancelled = true;
    if (pollRaf) cancelAnimationFrame(pollRaf);
    pollRaf = 0;
    mutationObserver?.disconnect();
    mutationObserver = null;
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = null;
  };

  const giveUp = () => {
    cleanup();
    onGiveUp?.();
  };

  const tryFound = (): boolean => {
    if (cancelled) return true;
    wakeDeferredSectionsForTarget(id);
    if (!document.getElementById(id)) return false;
    cleanup();
    onFound();
    return true;
  };

  mutationObserver = new MutationObserver(() => {
    tryFound();
  });
  mutationObserver.observe(document.body, { childList: true, subtree: true });

  const poll = () => {
    if (cancelled) return;
    if (tryFound()) return;
    if (performance.now() - startedAt >= maxMs) {
      giveUp();
      return;
    }
    pollRaf = requestAnimationFrame(poll);
  };
  pollRaf = requestAnimationFrame(poll);

  timeoutId = setTimeout(() => {
    if (cancelled) return;
    if (!tryFound()) giveUp();
  }, maxMs);

  return cleanup;
}

/**
 * Scroll to section `id` once. Default `smooth` (same-page via useInternalNav).
 * If the node is missing, waits until it appears, then scrolls once.
 */
export function scrollToSectionWhenReady(
  id: string,
  options?: ScrollToSectionWhenReadyOptions,
): () => void {
  if (typeof window === "undefined" || !id) return () => {};

  const maxMs = options?.maxMs ?? 5000;
  const behavior = options?.behavior ?? "smooth";

  const run = () => scrollOnce(id, behavior);

  if (document.getElementById(id)) {
    run();
    return () => {};
  }

  return waitForSectionId(id, maxMs, run);
}

/** Page arrival with hash: wait for node, settle deferred layout, then one auto jump. */
export function scrollToLocationHashWhenReady(
  options?: ScrollToLocationHashWhenReadyOptions,
): () => void {
  const id = parseLocationHashSectionId();
  if (!id) return () => {};

  const maxMs = options?.maxMs ?? 5000;
  let alignCleanup: (() => void) | null = null;

  const runAlign = () => {
    alignCleanup = alignLocationHashAfterDeferredLayout(id, { maxSettleMs: maxMs });
  };

  if (document.getElementById(id)) {
    runAlign();
    return () => alignCleanup?.();
  }

  const waitCleanup = waitForSectionId(id, maxMs, runAlign);

  return () => {
    waitCleanup();
    alignCleanup?.();
  };
}

/** When `ready` is true and the URL has a hash, align after deferred layout. */
export function useScrollToLocationHashWhenReady(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    if (typeof window === "undefined" || !window.location.hash) return;
    return scrollToLocationHashWhenReady();
  }, [ready]);
}
