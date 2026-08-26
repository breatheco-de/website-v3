import { UniversalImage } from "@/components/UniversalImage";
import type { OverlayContent } from "@/hooks/useOverlays";

interface OverlayContentImageProps {
  content: OverlayContent;
  className?: string;
}

/** Renders overlay hero image from media gallery id or a public image_url. */
export function OverlayContentImage({ content, className = "w-full object-cover max-h-36" }: OverlayContentImageProps) {
  if (content.image_url?.trim()) {
    return (
      <img
        src={content.image_url}
        alt={content.title}
        className={className}
      />
    );
  }
  if (content.image_id?.trim()) {
    return (
      <UniversalImage
        id={content.image_id}
        alt={content.title}
        className={className}
      />
    );
  }
  return null;
}

export function overlayHasImage(content: OverlayContent): boolean {
  return Boolean(content.image_url?.trim() || content.image_id?.trim());
}
