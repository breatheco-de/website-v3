import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useInternalNav } from "@/hooks/useInternalNav";
import { Check } from "lucide-react";
import { getIcon as resolveIcon } from "@/lib/icons";
import type { CSSProperties } from "react";
import UniversalImage from "@/components/UniversalImage";
import type { HumanAndAIDuoSection } from "@shared/schema";
import { UniversalVideo } from "@/components/UniversalVideo";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { inlineMarkdownToHtml } from "@/lib/inline-markdown";

// Image type for styling
interface StyledImageProps {
  src: string;
  alt?: string;
  object_fit?: "cover" | "contain" | "fill" | "none" | "scale-down";
  object_position?: string;
  width?: string;
  height?: string;
  max_width?: string;
  max_height?: string;
  border_radius?: string;
  opacity?: number;
  filter?: string;
}

const defaultStudentImages: StyledImageProps[] = [
  { src: "student_asian", alt: "Student 1" },
  { src: "student_latin_male", alt: "Student 2" },
  { src: "student_african", alt: "Student 3" },
  { src: "student_latina_female", alt: "Student 4" },
];

function getImageStyle(image: StyledImageProps): CSSProperties {
  return {
    objectFit: image.object_fit || "cover",
    objectPosition: image.object_position || "center top",
    width: image.width || "100%",
    height: image.height || "100%",
    maxWidth: image.max_width,
    maxHeight: image.max_height,
    borderRadius: image.border_radius || "0.5rem",
    opacity: image.opacity,
    filter: image.filter,
  };
}

interface HumanAndAIDuoData {
  type: "human_and_ai_duo";
  version?: string;
  heading: string;
  description: string;
  bullet_groups?: HumanAndAIDuoSection["bullet_groups"];
  cta?: HumanAndAIDuoSection["cta"];
  footer_description?: string;
  // New format: array of images with CSS styling
  images?: StyledImageProps[];
  // Legacy format: single image (backward compatible)
  image?: string;
  image_alt?: string;
  background?: string;
  // Video option - when provided, replaces images with video
  // Accepts either string URL (legacy) or full config object
  video?: string | {
    url: string;
    ratio?: string;
    mobile_ratio?: string;
    width?: string;
    muted?: boolean;
    autoplay?: boolean;
    loop?: boolean;
    preview_image_url?: string;
    with_shadow_border?: boolean;
  };
  // Legacy fields for backward compatibility (used when video is a string)
  video_ratio?: string;
  video_preview_image?: string;
}

interface HumanAndAIDuoProps {
  data: HumanAndAIDuoData;
}

const renderIcon = (iconName: string, className?: string, size?: number, color?: string) => {
  const IconComponent = resolveIcon(iconName.startsWith("Icon") ? iconName : `Icon${iconName}`);
  if (!IconComponent) return null;
  const sizeStr = size ? `${size}px` : "20px";
  return (
    <IconComponent
      className={className}
      size={size || 20}
      color={color}
      width={sizeStr}
      height={sizeStr}
    />
  );
};

// Normalize video config - handles both legacy string format and new object format
function normalizeVideo(
  video: string | { url: string; ratio?: string; preview_image_url?: string; width?: string } | undefined,
  videoRatio?: string,
  videoPreviewImage?: string
): { url: string; ratio?: string; preview_image_url?: string; width?: string } | null {
  if (!video) return null;
  if (typeof video === "string") {
    return { url: video, ratio: videoRatio, preview_image_url: videoPreviewImage };
  }
  return video;
}

export function HumanAndAIDuo({ data }: HumanAndAIDuoProps) {
  const backgroundClass = data.background || "bg-background";
  const hasBulletGroups = !!data.bullet_groups && data.bullet_groups.length > 0;
  const handleLinkClick = useInternalNav();

  const getButtonVariant = (variant?: string) => {
    if (variant === "primary") return "default";
    if (variant === "outline") return "outline";
    if (variant === "accent") return "accent";
    return "secondary";
  };

  const renderCta = (testId: string) => {
    if (!data.cta?.text || !data.cta?.url) return null;
    return (
      <Button
        variant={getButtonVariant(data.cta.variant)}
        asChild
        className="mt-4"
        data-testid={testId}
      >
        <a href={data.cta.url} onClick={handleLinkClick}>{data.cta.text}</a>
      </Button>
    );
  };
  const videoConfig = normalizeVideo(data.video, data.video_ratio, data.video_preview_image);
  const hasVideo = !!videoConfig?.url;
  
  // Use custom images array if provided, otherwise always show default 4 student images
  // Note: legacy image/image_alt fields are kept for backward compatibility but don't affect the student images display
  const images: StyledImageProps[] = data.images && data.images.length > 0 
    ? data.images 
    : defaultStudentImages;

  const renderMedia = (containerClass: string, testId: string) => {
    if (hasVideo && videoConfig) {
      const videoWidth = videoConfig.width || "400px";
      return (
        <div className="flex justify-end">
          <div 
            className={containerClass} 
            style={{ maxWidth: videoWidth }}
            data-testid={testId}
          >
            <UniversalVideo
              url={videoConfig.url}
              ratio={videoConfig.ratio || "2.39:1"}
              preview_image_url={videoConfig.preview_image_url}
            />
          </div>
        </div>
      );
    }
    return (
      <div className={containerClass} data-testid={testId}>
        {images.map((image, index) => (
          <div key={index} className="flex-1 h-full">
            <UniversalImage
              id={image.src}
              alt={image.alt || `Image ${index + 1}`}
              className="w-full h-full"
              style={getImageStyle(image)}
              fieldContext={data.images && data.images.length > 0 ? { arrayPath: "images", index, srcField: "src" } : undefined}
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <section 
      className={backgroundClass}
      data-testid="section-human-and-ai-duo"
    >
      <div className="max-w-6xl mx-auto px-4">
        {/* ===== MOBILE LAYOUT (base, hidden at md+) ===== */}
        <div className="md:hidden space-y-6">
          <div className="text-left">
            <h2 className="text-3xl font-bold text-foreground mb-3" data-testid="text-human-ai-heading">
              {data.heading}
            </h2>
            <RichTextContent
              html={inlineMarkdownToHtml(data.description)}
              className="text-base text-muted-foreground leading-relaxed"
              data-testid="text-human-ai-description-mobile"
            />
            {renderCta("button-human-ai-cta-mobile")}
          </div>
          {renderMedia(
            hasVideo ? "w-full" : "flex justify-center gap-3 w-full h-36",
            "img-students-mobile"
          )}
          {hasBulletGroups && (
          <Card className="p-0 overflow-hidden" data-testid="card-info-container-mobile">
            <div className="divide-y divide-border">
              {(data.bullet_groups ?? []).map((group, groupIndex) => (
                <div key={groupIndex} className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    {group.icon ? (
                      <span className="text-primary flex-shrink-0">{renderIcon(group.icon, "w-6 h-6")}</span>
                    ) : (
                      <div className="flex-shrink-0 w-6 h-6 rounded-full overflow-hidden">
                        <UniversalImage id={group.image || "rigo-avatar-1763181725290"} alt="Support icon" className="w-full h-full" style={{ objectFit: "cover" }} />
                      </div>
                    )}
                    <h4 className="font-semibold text-foreground uppercase tracking-wide text-xs">{group.title}</h4>
                  </div>
                  {group.description && (
                    <RichTextContent
                      html={inlineMarkdownToHtml(group.description)}
                      className="text-muted-foreground text-sm mb-3"
                    />
                  )}
                  {group.bullets && group.bullets.length > 0 && (
                    <ul className="space-y-2">
                      {group.bullets.map((bullet, bulletIndex) => (
                        <li key={bulletIndex} className="flex items-start gap-2">
                          <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                          <span className="text-foreground text-sm">{bullet.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>
          )}
          {data.footer_description && (
            <RichTextContent
              html={inlineMarkdownToHtml(data.footer_description)}
              className="text-sm text-muted-foreground leading-relaxed italic text-center"
              data-testid="text-human-ai-footer-mobile"
            />
          )}
        </div>

        {/* ===== TABLET LAYOUT (md to lg-1, hidden below md and at lg+) ===== */}
        <div className="hidden md:block lg:hidden space-y-8">
          <div className="grid grid-cols-12 gap-6 items-start">
            <div className="col-span-7 text-left">
              <h2 className="text-3xl font-bold text-foreground mb-3" data-testid="text-human-ai-heading-tablet">
                {data.heading}
              </h2>
              <RichTextContent
                html={inlineMarkdownToHtml(data.description)}
                className="text-base text-muted-foreground leading-relaxed"
                data-testid="text-human-ai-description-tablet"
              />
              {renderCta("button-human-ai-cta-tablet")}
            </div>
            <div className="col-span-5">
              {renderMedia(
                hasVideo ? "w-full" : "flex gap-3 h-40",
                "img-students-tablet"
              )}
            </div>
          </div>
          {hasBulletGroups && (
          <Card className="p-0 overflow-hidden hover:shadow-md transition-shadow duration-200" data-testid="card-info-container-tablet">
            <div className="grid grid-cols-2 divide-x divide-border">
              {(data.bullet_groups ?? []).map((group, groupIndex) => (
                <div key={groupIndex} className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    {group.icon ? (
                      <span className="text-primary flex-shrink-0">{renderIcon(group.icon, "w-7 h-7")}</span>
                    ) : (
                      <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden">
                        <UniversalImage id={group.image || "rigo-avatar-1763181725290"} alt="Support icon" className="w-full h-full" style={{ objectFit: "cover" }} />
                      </div>
                    )}
                    <h4 className="font-semibold text-foreground uppercase tracking-wide text-xs">{group.title}</h4>
                  </div>
                  {group.description && (
                    <RichTextContent
                      html={inlineMarkdownToHtml(group.description)}
                      className="text-muted-foreground text-sm mb-3"
                    />
                  )}
                  {group.bullets && group.bullets.length > 0 && (
                    <ul className="space-y-2">
                      {group.bullets.map((bullet, bulletIndex) => (
                        <li key={bulletIndex} className="flex items-start gap-2">
                          <Check className="w-4 h-4 text-primary mt-0.5 flex-shrink-0" />
                          <span className="text-foreground text-sm">{bullet.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>
          )}
          {data.footer_description && (
            <RichTextContent
              html={inlineMarkdownToHtml(data.footer_description)}
              className="text-sm text-muted-foreground leading-relaxed italic text-left"
              data-testid="text-human-ai-footer-tablet"
            />
          )}
        </div>

        {/* ===== DESKTOP LAYOUT (lg+, Notion-like layout) ===== */}
        <div className="hidden lg:block space-y-8">
          <div className="grid grid-cols-12 gap-8 items-start">
            <div className={`${hasVideo ? "col-span-7" : "col-span-7"}`}>
              <h2 className="text-4xl font-bold text-foreground mb-4 w-full" data-testid="text-human-ai-heading">
                {data.heading}
              </h2>
              <RichTextContent
                html={inlineMarkdownToHtml(data.description)}
                className="text-lg text-muted-foreground leading-relaxed"
                data-testid="text-human-ai-description"
              />
              {renderCta("button-human-ai-cta-desktop")}
            </div>
            <div className={`${hasVideo ? "col-span-5" : "col-span-5 flex items-start gap-4 bg-primary/5 p-4 rounded-card h-44"}`}>
              {renderMedia(
                hasVideo ? "w-full" : "flex gap-4 h-full w-full",
                "img-students-desktop"
              )}
            </div>
          </div>
          {hasBulletGroups && (
          <Card className="p-0 overflow-hidden hover:shadow-md transition-shadow duration-200" data-testid="card-info-container">
            <div className="grid grid-cols-2 divide-x divide-border" data-testid="list-human-ai-groups">
              {(data.bullet_groups ?? []).map((group, groupIndex) => (
                <div key={groupIndex} className="p-8">
                  <div className="flex items-center gap-3 mb-5">
                    {group.icon ? (
                      <span className="text-primary flex-shrink-0">{renderIcon(group.icon, "w-8 h-8")}</span>
                    ) : (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden">
                        <UniversalImage id={group.image || "rigo-avatar-1763181725290"} alt="Support icon" className="w-full h-full" style={{ objectFit: "cover" }} />
                      </div>
                    )}
                    <h4 className="font-semibold text-foreground uppercase tracking-wide text-xs">{group.title}</h4>
                  </div>
                  {group.description && (
                    <RichTextContent
                      html={inlineMarkdownToHtml(group.description)}
                      className="text-muted-foreground text-base mb-4"
                    />
                  )}
                  {group.bullets && group.bullets.length > 0 && (
                    <ul className="space-y-3">
                      {group.bullets.map((bullet, bulletIndex) => (
                        <li key={bulletIndex} className="flex items-start gap-3">
                          <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                          <span className="text-foreground text-base">{bullet.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>
          )}
          {data.footer_description && (
            <RichTextContent
              html={inlineMarkdownToHtml(data.footer_description)}
              className="text-base text-muted-foreground leading-relaxed italic"
              data-testid="text-human-ai-footer"
            />
          )}
        </div>
      </div>
    </section>
  );
}

export type { HumanAndAIDuoData };

export default HumanAndAIDuo;
