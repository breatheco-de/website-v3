import { Bot } from "lucide-react";
import { PreviewDeviceMenu } from "@/components/editing/PreviewDeviceMenu";
import { PreviewShareButton } from "@/components/editing/PreviewShareButton";
import { LocationOverrideBadge } from "@/components/DebugBubble/components/LocationOverrideBadge";
import { useEnterVisualEditMode } from "@/hooks/useEnterVisualEditMode";

/** Staff chrome for AI-crawler preview (public pages and /private/preview). */
export function LlmPreviewTopBar() {
  const enterPrivatePreview = useEnterVisualEditMode();

  return (
    <div
      className="sticky top-0 z-[10000] border-b border-amber-500/60 bg-amber-500/15 backdrop-blur supports-[backdrop-filter]:bg-amber-500/20 dark:bg-amber-500/20 dark:supports-[backdrop-filter]:bg-amber-500/25"
      data-testid="llm-preview-topbar"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
        <div className="flex min-w-0 flex-col gap-0.5 text-amber-900 dark:text-amber-100">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            <Bot className="h-3.5 w-3.5 shrink-0" />
            <span>Viewing as an AI crawler</span>
          </div>
          <p className="text-[10px] leading-snug text-amber-800/80 dark:text-amber-100/70 pl-5">
            Navbar, footer and page title use your detected campus.
          </p>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <PreviewDeviceMenu trigger="caption" onNeedEditMode={enterPrivatePreview} />
          <LocationOverrideBadge readOnlyLlm />
          <PreviewShareButton />
        </div>
      </div>
    </div>
  );
}
