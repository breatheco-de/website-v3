import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { useParams } from "wouter";
import { SectionRenderer } from "@/components/SectionRenderer";
import type { Section } from "@shared/schema";

const DEMO_HASH_RE = /^[a-f0-9]{32}$/;

function sanitizeDemoSections(input: unknown[]): Section[] {
  return input
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map((s) => {
      const clone = { ...s };
      delete (clone as { showOnLocations?: unknown }).showOnLocations;
      delete (clone as { showOnRegions?: unknown }).showOnRegions;
      return clone as Section;
    });
}

/**
 * Temporary single-section preview for MCP-created demos.
 * Hash in the URL is the only access control; not published site content.
 */
export default function ComponentSectionDemoPage() {
  const { hash } = useParams<{ hash: string }>();
  const [sections, setSections] = useState<Section[]>([]);
  const [componentType, setComponentType] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex, nofollow";
    document.head.appendChild(meta);
    document.title = "Temporary section demo";
    return () => {
      document.head.removeChild(meta);
    };
  }, []);

  useEffect(() => {
    if (!hash || !DEMO_HASH_RE.test(hash)) {
      setError("Invalid demo link");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(`/api/component-section-demos/${encodeURIComponent(hash)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body.error === "string" ? body.error : `Demo not found (${res.status})`,
          );
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const section = data.section;
        if (!section || typeof section !== "object") {
          setError("Demo payload is empty");
          return;
        }
        setComponentType(
          typeof data.componentType === "string" ? data.componentType : null,
        );
        setSections(sanitizeDemoSections([section]));
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message || "Failed to load demo");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [hash]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px] bg-background">
        <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[200px] gap-2 bg-background text-muted-foreground text-sm">
        <p>{error}</p>
        <p className="text-xs">This temporary demo may have expired after a redeploy.</p>
      </div>
    );
  }

  return (
    <div className="bg-background min-h-screen" data-testid="component-section-demo">
      <div className="sticky top-0 z-50 border-b bg-background/90 backdrop-blur px-4 py-2 text-xs text-muted-foreground">
        Temporary section preview
        {componentType ? ` (${componentType})` : ""} — not published site content. Link expires on
        redeploy.
      </div>
      {sections.length > 0 ? (
        <SectionRenderer sections={sections} />
      ) : (
        <div className="flex items-center justify-center min-h-[200px] text-muted-foreground text-sm">
          No content to display
        </div>
      )}
    </div>
  );
}
