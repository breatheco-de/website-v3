import { renderToPipeableStream } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { Router } from "wouter";
import { PassThrough } from "node:stream";
import App from "./App";
import { LlmAudienceContext } from "./contexts/LlmAudienceContext";
import { preloadSectionsFromInitialData } from "./components/sectionRegistry";
import { preloadPublicPageChunks } from "./lib/preloadPublicPageChunk";
import { setThemePaint, type ThemePaint } from "@shared/theme-palette";

interface SingleQuery {
  queryKey: unknown[];
  data: unknown;
}

type InitialDataPayload =
  | { queries: SingleQuery[]; queryKey?: never; data?: never }
  | { queryKey: unknown[]; data: unknown; queries?: never };

function suppressLayoutEffectWarnings(): () => void {
  const original = console.error;
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      args[0].includes("useLayoutEffect does nothing on the server")
    ) {
      return;
    }
    original.apply(console, args);
  };
  return () => {
    console.error = original;
  };
}

function installSsrLocation(url: string): () => void {
  const g = globalThis as typeof globalThis & { location?: unknown };
  const previous = Object.getOwnPropertyDescriptor(g, "location");
  const hashIdx = url.indexOf("#");
  const withoutHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = withoutHash.indexOf("?");
  const pathname = (qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash) || "/";
  const search = qIdx >= 0 ? withoutHash.slice(qIdx) : "";
  const href = `https://ssr.local${pathname}${search}`;

  const shim = {
    pathname,
    search,
    hash: hashIdx >= 0 ? url.slice(hashIdx) : "",
    href,
    origin: "https://ssr.local",
    host: "ssr.local",
    hostname: "ssr.local",
    port: "",
    protocol: "https:",
    assign() {},
    replace() {},
    reload() {},
  };

  Object.defineProperty(g, "location", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: shim,
  });

  return () => {
    if (previous) {
      Object.defineProperty(g, "location", previous);
    } else {
      Reflect.deleteProperty(g, "location");
    }
  };
}

function seedQueryClient(
  client: QueryClient,
  payload: InitialDataPayload | null,
): void {
  if (!payload) return;

  if (payload.queries && Array.isArray(payload.queries)) {
    for (const { queryKey, data } of payload.queries) {
      client.setQueryData(
        queryKey as Parameters<typeof client.setQueryData>[0],
        data,
      );
    }
  } else if (payload.queryKey && payload.data !== undefined) {
    client.setQueryData(
      payload.queryKey as Parameters<typeof client.setQueryData>[0],
      payload.data,
    );
  }
}

export async function render(
  url: string,
  initialDataPayload: InitialDataPayload | null,
  options?: { llmAudience?: boolean },
): Promise<string> {
  const themePaint = (initialDataPayload as { themePaint?: ThemePaint } | null)?.themePaint ?? null;
  setThemePaint(themePaint);
  const restoreLocation = installSsrLocation(url);
  const ssrQueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: Infinity,
      },
    },
  });

  seedQueryClient(ssrQueryClient, initialDataPayload);

  const hashIdx = url.indexOf("#");
  const withoutHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = withoutHash.indexOf("?");
  const ssrPath = (qIdx >= 0 ? withoutHash.slice(0, qIdx) : withoutHash) || "/";
  // Non-empty string so wouter's `props.ssrSearch || parent` does not drop it
  // (empty string is falsy and falls through to undefined).
  const ssrSearch = qIdx >= 0 ? withoutHash.slice(qIdx + 1) : "";

  const restore = suppressLayoutEffectWarnings();

  try {
    // Preload lazy route page + section chunks before streaming so Suspense
    // fallback={null} does not produce an empty #root.
    await Promise.all([
      preloadPublicPageChunks(ssrPath, initialDataPayload),
      preloadSectionsFromInitialData(initialDataPayload),
    ]);

    const html = await new Promise<string>((resolve, reject) => {
      let chunks = "";
      const passthrough = new PassThrough();
      passthrough.setEncoding("utf-8");
      passthrough.on("data", (chunk: string) => {
        chunks += chunk;
      });
      passthrough.on("end", () => resolve(chunks));
      passthrough.on("error", reject);

      const { pipe } = renderToPipeableStream(
        // location shim above covers wouter's bare `location.search` snapshot.
        // ssrPath/ssrSearch keep usePathname/useSearch server snapshots aligned.
        <LlmAudienceContext.Provider value={options?.llmAudience === true}>
          <Router ssrPath={ssrPath} ssrSearch={ssrSearch}>
            <App ssrQueryClient={ssrQueryClient} />
          </Router>
        </LlmAudienceContext.Provider>,
        {
          onAllReady() {
            pipe(passthrough);
          },
          onError(error: unknown) {
            reject(error);
          },
        },
      );
    });

    return html;
  } finally {
    restore();
    restoreLocation();
  }
}
