import { useEffect, useMemo, useRef, useState } from "react";
import { Monitor } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { LocationOverrideBadge } from "@/components/DebugBubble/components/LocationOverrideBadge";
import { PreviewDeviceMenu } from "@/components/editing/PreviewDeviceMenu";
import { PreviewShareButton } from "@/components/editing/PreviewShareButton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import {
  buildDeviceEmbedSrc,
  DEVICE_EMBED_NAV_BLOCKED,
  getPreviewDevice,
} from "@/lib/preview-devices";

export function DevicePreviewShell() {
  const editMode = useEditModeOptional();
  const [pathname] = useLocation();
  const search = useSearch();
  const device = getPreviewDevice(editMode?.previewDeviceId);
  const [scale, setScale] = useState(1);
  const [navBlockedOpen, setNavBlockedOpen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const iframeSrc = useMemo(
    () => buildDeviceEmbedSrc(pathname, search),
    [pathname, search],
  );

  useEffect(() => {
    const updateScale = () => {
      const captionAndPadding = 96;
      const availW = Math.max(120, window.innerWidth - 32);
      const availH = Math.max(120, window.innerHeight - captionAndPadding);
      setScale(Math.min(1, availW / device.width, availH / device.height));
    };
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [device.width, device.height]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== DEVICE_EMBED_NAV_BLOCKED) return;
      setNavBlockedOpen(true);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const isTablet = device.group === "tablet";

  return (
    <div className="flex flex-col items-center justify-center bg-muted/50 min-h-screen py-8 px-4 gap-3">
      <div className="flex items-center gap-2">
        <PreviewDeviceMenu trigger="caption" />
        <LocationOverrideBadge />
        <PreviewShareButton />
      </div>
      <div
        style={{
          width: device.width * scale,
          height: device.height * scale,
        }}
      >
        <div
          className={`bg-background shadow-2xl overflow-hidden outline outline-4 outline-foreground/20 origin-top-left ${
            isTablet ? "rounded-[20px]" : "rounded-[32px]"
          }`}
          style={{
            width: device.width,
            height: device.height,
            transform: `scale(${scale})`,
          }}
        >
          <iframe
            ref={iframeRef}
            src={iframeSrc}
            className="block border-0"
            style={{ width: device.width, height: device.height }}
            title={`Vista previa · ${device.label}`}
          />
        </div>
      </div>
      <Dialog open={navBlockedOpen} onOpenChange={setNavBlockedOpen}>
        <DialogContent className="sm:max-w-md bg-background" data-testid="dialog-device-embed-nav-blocked">
          <DialogHeader>
            <DialogTitle>Navigation is off in device preview</DialogTitle>
            <DialogDescription>
              Links stay on this page so the phone or tablet does not leave the current preview. Switch to desktop to follow links.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setNavBlockedOpen(false)}
              data-testid="button-device-embed-stay"
            >
              Stay here
            </Button>
            <Button
              onClick={() => editMode?.setPreviewMode({ kind: "desktop" })}
              data-testid="button-device-embed-desktop"
            >
              <Monitor className="h-4 w-4" />
              Switch to desktop
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
