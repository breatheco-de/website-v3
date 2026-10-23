import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Moon, RefreshCw, Sun } from "lucide-react";
import { SectionRenderer } from "@/components/SectionRenderer";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { measurePage, type PageMeasurements } from "@/lib/pageMeasurements";
import type { PageSettings, Section } from "@shared/schema";

interface PagePreviewPayload {
  source: "entry" | "demo";
  locale: string;
  sections: Section[];
  fingerprint: string;
  title?: string;
  layout_owner?: string;
  singleEntry?: Record<string, unknown>;
  error?: string;
}

const EAGER_SETTINGS = { loading: { eager_count: 999 } } as unknown as PageSettings;

function waitForImages(root: HTMLElement, timeoutMs = 8000): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  for (const img of images) img.loading = "eager";
  return Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) return resolve();
          img.addEventListener("load", () => resolve(), { once: true });
          img.addEventListener("error", () => resolve(), { once: true });
          setTimeout(resolve, timeoutMs);
        }),
    ),
  ).then(() => undefined);
}

/**
 * Full-page preview for the render review: every section of an entry (live
 * or draft variant) or of a throwaway page demo. When ready it publishes
 * layout measurements in #__page_measurements__ and sets
 * data-capture-ready="1" (Cloudflare waits for that selector).
 */
export default function PagePreviewPage() {
  const search = useSearch();
  const [location, navigate] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const isCapture = params.get("capture") === "1";
  const theme = params.get("theme") === "light" ? "light" : "dark";
  const dataQuery = useMemo(() => {
    const qs = new URLSearchParams(params);
    qs.delete("capture");
    qs.delete("theme");
    qs.delete("_");
    return qs.toString();
  }, [params]);

  const toggleTheme = () => {
    const qs = new URLSearchParams(params);
    if (theme === "dark") qs.set("theme", "light");
    else qs.delete("theme");
    const next = qs.toString();
    navigate(next ? `${location}?${next}` : location, { replace: true });
  };
  const [data, setData] = useState<PagePreviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [measurements, setMeasurements] = useState<PageMeasurements | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, [theme]);

  useEffect(() => {
    const token = getDebugToken();
    setData(null);
    setError(null);
    setMeasurements(null);
    fetch(`/api/page-preview/data?${dataQuery}`, {
      credentials: "include",
      headers: token ? { Authorization: `Token ${token}` } : {},
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as PagePreviewPayload;
        if (!res.ok) throw new Error(body.error || `Preview failed (${res.status})`);
        setData(body);
        if (body.title) document.title = `Preview — ${body.title}`;
      })
      .catch((e: Error) => setError(e.message));
  }, [dataQuery]);

  useEffect(() => {
    if (!data || !rootRef.current) return;
    let cancelled = false;
    const root = rootRef.current;
    void waitForImages(root).then(() => {
      setTimeout(() => {
        if (cancelled) return;
        const m = measurePage(root);
        (window as unknown as { __PAGE_MEASUREMENTS__?: PageMeasurements }).__PAGE_MEASUREMENTS__ = m;
        setMeasurements(m);
      }, 300);
    });
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (error) {
    return (
      <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 bg-background p-6 text-sm text-muted-foreground">
        <p>{error}</p>
        <p className="text-xs">Page demos expire after a redeploy; entry previews need staff login or a signed link.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-[200px] items-center justify-center bg-background">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const [contentType, slug] = [params.get("content_type") ?? undefined, params.get("slug") ?? undefined];
  return (
    <div
      ref={rootRef}
      data-screenshot-root
      data-capture-ready={measurements ? "1" : "0"}
      data-fingerprint={data.fingerprint}
      className="min-h-screen bg-background"
      data-testid="page-preview"
    >
      {!isCapture && (
        <div className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-border bg-background/90 px-4 py-2 text-xs text-muted-foreground backdrop-blur">
          <span>
            {data.source === "demo"
              ? "Throwaway page preview — not saved content. The link expires on redeploy."
              : `Page preview of ${contentType}/${slug} (${data.locale}${params.get("variant") ? `, draft ${params.get("variant")}` : ", live"}) — header and footer hidden.`}
            {measurements && measurements.findings.length > 0 && ` · ${measurements.findings.length} layout findings`}
          </span>
          <button
            type="button"
            onClick={toggleTheme}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2 py-1 text-foreground hover:bg-muted"
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            data-testid="button-preview-theme-toggle"
          >
            {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </div>
      )}
      <SectionRenderer
        sections={data.sections}
        settings={EAGER_SETTINGS}
        contentType={contentType}
        slug={slug}
        locale={data.locale}
        singleEntry={data.singleEntry}
      />
      {measurements && (
        <script
          type="application/json"
          id="__page_measurements__"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(measurements).replace(/</g, "\\u003c") }}
        />
      )}
    </div>
  );
}
