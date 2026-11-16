import { useState } from "react";
import { Check, Share2 } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { useToast } from "@/hooks/use-toast";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  buildShareablePreviewUrl,
  previewModeFromEditState,
} from "@/lib/preview-mode";

/** Copy a staff private-preview URL that encodes viewport + campus (campus omitted in LLM mode). */
export function PreviewShareButton() {
  const editMode = useEditModeOptional();
  const [pathname] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  if (!editMode) return null;

  const handleShare = async () => {
    const mode = previewModeFromEditState({
      previewBreakpoint: editMode.previewBreakpoint,
      previewDeviceId: editMode.previewDeviceId,
      isLlmPreview: editMode.isLlmPreview,
    });
    const url = buildShareablePreviewUrl({
      pathname,
      search: search.startsWith("?") ? search : `?${search}`,
      mode,
    });
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({
        title: "Preview link copied",
        description: editMode.isLlmPreview
          ? "Other signed-in staff get the AI crawler view (all regions)."
          : "Other signed-in staff get the same device and campus.",
      });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({
        title: "Could not copy link",
        description: "Copy the address bar URL manually.",
        variant: "destructive",
      });
    }
  };

  return (
    <button
      type="button"
      className={cn(
        badgeVariants({ variant: "outline" }),
        "cursor-pointer text-xs gap-1 no-default-active-elevate",
      )}
      onClick={handleShare}
      data-testid="button-preview-share"
      title="Copy shareable preview link"
    >
      {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
      <span>{copied ? "Copied" : "Share"}</span>
    </button>
  );
}
