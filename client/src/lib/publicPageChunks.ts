/**
 * Shared public/private page chunk loaders for SSR preload, client hydrate, and React.lazy.
 *
 * Magenta Suspense diagnostic proved the white flash is Router <Suspense> suspending on
 * React.lazy page chunks. Preload in main.tsx used a *different* import() promise than
 * lazy(), so hydrateRoot still suspended for a frame (or longer in Vite dev).
 *
 * Rule: preload and lazy MUST share the same Promise instance, marked with React's
 * thenable shape (`status: "fulfilled"`, `value`) after resolve. Never wrap that
 * promise in `.then`/`.catch`/async before handing it to lazy() — that creates a new
 * thenable and reintroduces the flash.
 */
import type { ComponentType } from "react";

type ModuleDefault<T> = { default: T };
type PageModule = ModuleDefault<ComponentType<any>>;

type FulfilledThenable<T> = Promise<T> & { status: "fulfilled"; value: T };
type RejectedThenable = Promise<never> & { status: "rejected"; reason: unknown };

let hmrConnected = true;

function waitForHmrReconnect(timeoutMs = 30_000): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined" || hmrConnected) {
      resolve();
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    const onConnect = () => {
      clearTimeout(timer);
      window.removeEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
      resolve();
    };
    window.addEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
    timer = setTimeout(() => {
      window.removeEventListener("vite:ws:connect" as keyof WindowEventMap, onConnect);
      resolve();
    }, timeoutMs);
  });
}

if (typeof window !== "undefined") {
  window.addEventListener("vite:ws:connect" as keyof WindowEventMap, () => {
    hmrConnected = true;
  });
  window.addEventListener("vite:ws:disconnect" as keyof WindowEventMap, () => {
    hmrConnected = false;
  });
  window.addEventListener("vite:beforeFullReload" as keyof WindowEventMap, () => {
    hmrConnected = false;
  });
}

/** Tag a promise so React.lazy can unwrap it synchronously after preload await. */
function trackReactThenable<T>(promise: Promise<T>): Promise<T> {
  const tracked = promise as Promise<T> & { status?: string };
  if (tracked.status === "fulfilled" || tracked.status === "rejected") {
    return promise;
  }
  promise.then(
    (value) => {
      const ok = promise as FulfilledThenable<T>;
      ok.status = "fulfilled";
      ok.value = value;
    },
    (reason) => {
      const bad = promise as RejectedThenable;
      bad.status = "rejected";
      bad.reason = reason;
    },
  );
  return promise;
}

const cache = new Map<string, Promise<PageModule>>();

async function importWithRetry(
  factory: () => Promise<PageModule>,
  retries = 3,
  delayMs = 600,
): Promise<PageModule> {
  let lastErr: unknown;
  for (let left = retries; left >= 0; left--) {
    try {
      return await factory();
    } catch (err) {
      lastErr = err;
      if (left <= 0) break;
      if (typeof window !== "undefined" && !hmrConnected) {
        await waitForHmrReconnect();
      }
      const backoff = delayMs * (4 - left);
      await new Promise<void>((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastErr;
}

/**
 * Canonical cached promise (same reference for preload + React.lazy).
 * Must NOT wrap in an async function / .then before returning to lazy().
 */
function cachedPageImport(key: string, factory: () => Promise<PageModule>): Promise<PageModule> {
  let pending = cache.get(key);
  if (!pending) {
    pending = trackReactThenable(importWithRetry(factory));
    cache.set(key, pending);
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });
  }
  return pending;
}

export function loadTemplatePageChunk(): Promise<PageModule> {
  return cachedPageImport("template-page", () => import("@/pages/page"));
}

export function loadContentTypeDetailChunk(): Promise<PageModule> {
  return cachedPageImport("content-type-detail", () => import("@/pages/ContentTypeDetail"));
}

export function loadDatabaseSinglePageChunk(): Promise<PageModule> {
  return cachedPageImport("database-single", () => import("@/pages/DatabaseSinglePage"));
}

export function loadPreviewFrameChunk(): Promise<PageModule> {
  return cachedPageImport("preview-frame", () => import("@/pages/PreviewFrame"));
}

export function loadPrivateRouterChunk(): Promise<PageModule> {
  return cachedPageImport("private-router", () => import("@/pages/PrivateRouter"));
}

export function loadTermsPageChunk(): Promise<PageModule> {
  return cachedPageImport("terms-page", () => import("@/pages/TermsPage"));
}

export function loadPrivacyPageChunk(): Promise<PageModule> {
  return cachedPageImport("privacy-page", () => import("@/pages/PrivacyPage"));
}
