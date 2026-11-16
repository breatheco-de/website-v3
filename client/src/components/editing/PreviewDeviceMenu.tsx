import { Bot, Check, ChevronDown, Monitor, MonitorSmartphone, Smartphone, Tablet } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useEditMode } from "@/contexts/EditModeContext";
import { cn } from "@/lib/utils";
import { getPreviewDevice, PREVIEW_PHONES, PREVIEW_TABLETS } from "@/lib/preview-devices";

type PreviewDeviceMenuTrigger = "icon" | "caption";

export function PreviewDeviceMenu({
  trigger = "icon",
  onNeedEditMode,
}: {
  trigger?: PreviewDeviceMenuTrigger;
  /** Opens `/private/preview/...` when picking a phone/tablet from a public URL (Read or Edit). */
  onNeedEditMode?: () => void;
}) {
  const editMode = useEditMode();
  const isLlmPreview = editMode.isLlmPreview;
  const isDevicePreview =
    !isLlmPreview && editMode.isEditMode && editMode.previewBreakpoint === "mobile";
  const activeDevice = isDevicePreview ? getPreviewDevice(editMode.previewDeviceId) : null;
  const previewTitle = isLlmPreview
    ? "Preview: AI crawler (any device)"
    : activeDevice
      ? `Preview: ${activeDevice.label} (${activeDevice.width} × ${activeDevice.height})`
      : "Preview: Desktop";

  const captionLabel = isLlmPreview
    ? "Any device LLM crawlers use"
    : activeDevice
      ? `${activeDevice.label} · ${activeDevice.width} × ${activeDevice.height}`
      : "Desktop";

  const selectDevice = (deviceId: typeof editMode.previewDeviceId) => {
    if (!editMode.isEditMode) {
      editMode.enableEditMode();
    }
    // Navigate to /private/preview first (when on a public URL), then sync mode into the URL.
    onNeedEditMode?.();
    editMode.setPreviewMode({ kind: "device", deviceId });
  };

  const selectDesktop = () => {
    onNeedEditMode?.();
    editMode.setPreviewMode({ kind: "desktop" });
  };

  const selectLlm = () => {
    // Open private preview before applying LLM mode so preview_mode lands on the staff URL.
    onNeedEditMode?.();
    editMode.setPreviewMode({ kind: "llm" });
  };

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {trigger === "caption" ? (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-muted-foreground tabular-nums hover:text-foreground transition-colors"
            data-testid="preview-device-caption"
            title={previewTitle}
          >
            {captionLabel}
            <ChevronDown className="h-3 w-3" />
          </button>
        ) : (
          <button
            type="button"
            onClick={(e) => e.stopPropagation()}
            className="p-1.5 rounded-full bg-muted text-muted-foreground transition-colors hover-elevate"
            data-testid="toggle-preview-breakpoint"
            title={previewTitle}
          >
            {isLlmPreview ? (
              <Bot className="h-3.5 w-3.5" />
            ) : (
              <MonitorSmartphone className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        className="w-64 z-[10001]"
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClick={(e) => e.stopPropagation()}
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          CSS viewport
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={selectDesktop}
          className={cn(
            "text-xs gap-2",
            !isDevicePreview && !isLlmPreview && "bg-accent font-medium",
          )}
          data-testid="button-preview-desktop"
        >
          <Monitor className="h-3.5 w-3.5" />
          Desktop
          {!isDevicePreview && !isLlmPreview && (
            <Check className="h-3.5 w-3.5 ml-auto text-foreground" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={selectLlm}
          className={cn("text-xs gap-2", isLlmPreview && "bg-accent font-medium")}
          data-testid="button-preview-llm"
        >
          <Bot className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">LLM crawler</span>
          {isLlmPreview && (
            <Check className="h-3.5 w-3.5 ml-auto text-foreground shrink-0" />
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {PREVIEW_PHONES.map((device) => {
          const isActive = isDevicePreview && editMode.previewDeviceId === device.id;
          return (
            <DropdownMenuItem
              key={device.id}
              onClick={() => selectDevice(device.id)}
              className={cn("text-xs gap-2", isActive && "bg-accent font-medium")}
              data-testid={`button-preview-${device.id}`}
            >
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{device.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                {device.width} × {device.height}
              </span>
              {isActive && (
                <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        {PREVIEW_TABLETS.map((device) => {
          const isActive = isDevicePreview && editMode.previewDeviceId === device.id;
          return (
            <DropdownMenuItem
              key={device.id}
              onClick={() => selectDevice(device.id)}
              className={cn("text-xs gap-2", isActive && "bg-accent font-medium")}
              data-testid={`button-preview-${device.id}`}
            >
              <Tablet className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{device.label}</span>
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                {device.width} × {device.height}
              </span>
              {isActive && (
                <Check className="h-3.5 w-3.5 text-foreground shrink-0" />
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div
          className="px-2 py-1.5 text-[10px] leading-snug text-muted-foreground space-y-1"
          data-testid="preview-device-education"
          onPointerDown={(e) => e.preventDefault()}
        >
          <p>
            Device preview always lives on <code className="bg-muted px-1 rounded">/private/preview/…</code> (locale, variant, version). LLM crawler shows the page the way AI crawlers see it — all regions at once; editing is off until you switch back to Desktop or a phone. Share copies the current viewport and campus (campus omitted in LLM mode).
          </p>
          <details>
            <summary className="cursor-pointer hover:text-foreground">Read more (advanced)</summary>
            <ul className="mt-1 list-disc pl-3 space-y-0.5">
              <li>URL: <code className="bg-muted px-1 rounded">preview_mode</code> in <code className="bg-muted px-1 rounded">client/src/lib/preview-mode.ts</code></li>
              <li>Presets and device storage: <code className="bg-muted px-1 rounded">client/src/lib/preview-devices.ts</code></li>
              <li>Embed flag: <code className="bg-muted px-1 rounded">device_embed=1</code></li>
            </ul>
          </details>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
