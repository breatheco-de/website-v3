
import { useState } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import UniversalImage from "@/components/UniversalImage";
import { UniversalVideo } from "@/components/UniversalVideo";
import { RichTextContent } from "@/components/ui/rich-text-content";
import type { HeroSingleColumn } from "@shared/schema";
import { createElement } from "react";
import { getIcon } from "@/lib/icons";
import { useInternalNav } from "@/hooks/useInternalNav";
import { resolveTemplateFallback, coerceToText, coerceToHtml } from "@/lib/variable-manager";

const BLOG_IMAGE_FALLBACK = "https://storage.googleapis.com/4geeks-academy-website/media/Group-original_1765419144159.webp";

const DEFAULT_AVATAR_IDS = [
  "woman-profile-headshot-1-608aff01",
  "man-profile-headshot-1-0850c276",
  "woman-profile-headshot-2-a0ea2c29",
  "man-profile-headshot-2-516b72e4",
];

interface HeroSingleColumnProps {
  data: HeroSingleColumn;
}

export default function HeroSingleColumn({ data }: HeroSingleColumnProps) {
  const avatarIds = data.trust_bar?.avatars?.length ? data.trust_bar.avatars : DEFAULT_AVATAR_IDS;
  const handleLinkClick = useInternalNav();

  const [fallbackSrc, setFallbackSrc] = useState<string | undefined>();

  const rawSrc = data.image?.src !== "undefined" ? data.image?.src : BLOG_IMAGE_FALLBACK;
  // In edit mode, patchVariableFieldHighlights stores "{{ single.image | resolvedUrl }}" in
  // data.image.src (a template string, not a real URL). resolveTemplateFallback extracts the
  // embedded resolved URL so UniversalImage receives a valid URL it can actually render.
  // Without this, id="{{...}}" causes UniversalImage to return null (not a direct URL / registry
  // entry), silently hiding both the image AND the override badge.
  const resolvedRawSrc = resolveTemplateFallback(rawSrc ?? "");
  const imgSrc = fallbackSrc ?? resolvedRawSrc ?? (data as any).image_id;

  // Read _variableKeys directly from the section data so templateKey reaches UniversalImage
  // regardless of whether SectionContext variableKeys propagation is working.
  const sectionVarKeys = (data as any)._variableKeys as Record<string, string> | undefined;
  const imageTemplateKey = sectionVarKeys?.["image.src"];

  const handleHeroError = () => {
    setFallbackSrc(data.image?.fallback ?? BLOG_IMAGE_FALLBACK);
  };

  const video = data.video;
  const videoUrl = typeof video?.url === "string" ? video.url.trim() : "";
  const hasVideo = videoUrl.length > 0;
  const hasMedia = hasVideo || Boolean(imgSrc);
  const ctaBelowMedia = data.cta_below_media === true;
  const hasCtas = Boolean(data.cta_buttons && data.cta_buttons.length > 0);

  // Badge values can arrive as plain strings or as objects (e.g. a category
  // entry like { slug: "..." } from static YAML content) — coerce to a
  // renderable string so React never receives a raw object child.
  const badgeText = coerceToText(data.badge);

  const renderCtaButtons = (className: string) => {
    if (!hasCtas || !data.cta_buttons) return null;
    return (
      <div className={className}>
        {data.cta_buttons.map((button, index) => (
          <Button
            key={index}
            variant={button.variant === "primary" ? "default" : button.variant}
            size="lg"
            asChild
            data-testid={`button-hero-cta-${index}`}
          >
            <a href={button.url} onClick={handleLinkClick} className="flex items-center gap-2">
              {button.icon && (() => { const Ic = getIcon(button.icon); return Ic ? createElement(Ic, { className: "h-4 w-4" }) : null; })()}
              {button.text}
            </a>
          </Button>
        ))}
      </div>
    );
  };

  return (
    <section 
      data-testid="section-hero"
    >
      <div className="max-w-6xl mx-auto px-4 text-center">
        {badgeText && (
          <Badge 
            variant="secondary" 
            className="mb-6"
            data-testid="badge-hero"
          >
            {badgeText}
          </Badge>
        )}
        
        <h1 
          className="text-4xl md:text-h1 mb-6 text-foreground"
          data-testid="text-hero-title"
          dangerouslySetInnerHTML={{ __html: coerceToHtml(data.title) }}
        />
        
        {coerceToHtml(data.subtitle) && (
          <RichTextContent 
            html={coerceToHtml(data.subtitle)}
            className="text-body text-muted-foreground max-w-3xl mx-auto mb-8 leading-relaxed [&_p]:mb-0"
            data-testid="text-hero-subtitle"
          />
        )}

        {data.trust_bar && (
          <div 
            className="flex items-center justify-center gap-3 mb-8"
            data-testid="trust-bar"
          >
            <div className="flex -space-x-2">
              {avatarIds.map((avatarId, index) => (
                <Avatar 
                  key={index} 
                  className="h-8 w-8 border-2 border-background"
                >
                  <UniversalImage
                    id={avatarId}
                    alt={`Student ${index + 1}`}
                    className="h-full w-full"
                    style={{ objectFit: "cover" }}
                    fieldContext={{ arrayPath: "trust_bar.avatars", index }}
                  />
                </Avatar>
              ))}
            </div>

            <div className="flex flex-col items-start gap-0.5">
              {data.trust_bar.rating && (
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{data.trust_bar.rating || ""}</span>
                  <div className="flex">
                    {[1, 2, 3, 4].map((i) => (
                      <Star
                        key={i}
                        className="fill-current text-yellow-500 w-4 h-4"
                      />
                    ))}
                    <Star className="text-yellow-500 w-4 h-4" />
                  </div>
                </div>
              )}
              <span className="text-sm text-muted-foreground">
                {data.trust_bar.trusted_text}
              </span>
            </div>
          </div>
        )}
        
        {!ctaBelowMedia &&
          renderCtaButtons("flex flex-wrap justify-center gap-4 mb-12")}
      </div>
      {(hasVideo || imgSrc) && (
        <div className={data.image_full_width ? "w-full mt-8" : "max-w-3xl mx-auto px-4 mt-8 flex justify-center"}>
          {hasVideo ? (
            <div
              className="w-full"
              style={{ width: video?.width || data.image_width || "100%" }}
              data-testid="video-hero-single-column"
            >
              <UniversalVideo
                url={videoUrl}
                ratio={video?.ratio || "16:9"}
                mobileRatio={video?.mobile_ratio || "16:11"}
                muted={video?.muted}
                autoplay={video?.autoplay}
                loop={video?.loop}
                preview_image_url={video?.preview_image_url}
                withShadowBorder={video?.with_shadow_border}
                open_modal_on_click={video?.open_modal_on_click}
                show_controls_on_autoplay={video?.show_controls_on_autoplay === true}
                overlay_on_muted={video?.overlay_on_muted}
                className="w-full"
              />
            </div>
          ) : (
            <UniversalImage
              key={imgSrc}
              id={imgSrc}
              alt={data.image?.alt || ""}
              preset="hero-wide"
              className={`w-full rounded-none ${data.image_full_width ? "max-h-[250px]" : ""}`}
              style={{
                width: data.image_width || "100%",
                ...(data.image_full_width ? {} : { borderRadius: "0.8rem" }),
              }}
              onError={handleHeroError}
              loading="eager"
              data-testid="img-hero-single-column"
              fieldContext={
                (data as any).image_id
                  ? { fieldPath: "image_id", templateKey: imageTemplateKey }
                  : data.image?.src
                    ? { fieldPath: "image.src", templateKey: imageTemplateKey }
                    : undefined
              }
            />
          )}
        </div>
      )}
      {ctaBelowMedia &&
        renderCtaButtons(
          hasMedia
            ? "flex flex-wrap justify-center gap-4 mt-8 max-w-6xl mx-auto px-4"
            : "flex flex-wrap justify-center gap-4 mt-8 mb-4 max-w-6xl mx-auto px-4",
        )}
    </section>
  );
}
