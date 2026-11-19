import { lazy, Suspense, type ReactNode } from "react";
import { useLocation } from "wouter";
import { LlmAudienceContext, useLlmAudience } from "@/contexts/LlmAudienceContext";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { isVisualEditPath } from "@/lib/visual-edit-path";

const LlmPreviewTopBar = lazy(() =>
  import("@/components/editing/LlmPreviewTopBar").then((m) => ({ default: m.LlmPreviewTopBar })),
);

/**
 * Staff LLM crawler preview chrome + audience flag for public pages and
 * /private/preview. Lazy-loads the amber bar so visitors never download it.
 * Server crawler SSR keeps its own provider value via `inherited`.
 */
export function LlmCrawlerPreview({ children }: { children: ReactNode }) {
  const inherited = useLlmAudience();
  const editMode = useEditModeOptional();
  const [pathname] = useLocation();
  const active = !!editMode?.isLlmPreview && isVisualEditPath(pathname);
  return (
    <LlmAudienceContext.Provider value={inherited || active}>
      {active ? (
        <Suspense fallback={null}>
          <LlmPreviewTopBar />
        </Suspense>
      ) : null}
      {children}
    </LlmAudienceContext.Provider>
  );
}
