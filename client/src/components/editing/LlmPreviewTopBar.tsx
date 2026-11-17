import { Bot } from "lucide-react";
import { PreviewDeviceMenu } from "@/components/editing/PreviewDeviceMenu";
import { PreviewShareButton } from "@/components/editing/PreviewShareButton";
import { LocationOverrideBadge } from "@/components/DebugBubble/components/LocationOverrideBadge";

/** Staff chrome for AI-crawler preview on /private/preview (not part of the public page). */
export function LlmPreviewTopBar() {
  return (
    <div
      className="sticky top-0 z-[10000] border-b border-amber-500/60 bg-amber-500/15 backdrop-blur supports-[backdrop-filter]:bg-amber-500/20 dark:bg-amber-500/20 dark:supports-[backdrop-filter]:bg-amber-500/25"
      data-testid="llm-preview-topbar"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2 px-4 py-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-amber-900 dark:text-amber-100">
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span>Viewing as an AI crawler</span>
        </div>
        <div className="flex items-center gap-2 ml-auto">
          <PreviewDeviceMenu trigger="caption" />
          <LocationOverrideBadge readOnlyLlm />
          <PreviewShareButton />
        </div>
      </div>
    </div>
  );
}
