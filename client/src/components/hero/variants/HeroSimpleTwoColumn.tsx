import type { CSSProperties } from "react";
import type { HeroSimpleTwoColumn as HeroSimpleTwoColumnType } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { UniversalVideo } from "@/components/UniversalVideo";
import { UniversalImage } from "@/components/UniversalImage";
import { createElement } from "react";
import { getIcon } from "@/lib/icons";
import { useInternalNav } from "@/hooks/useInternalNav";
import { coerceToText, coerceToHtml } from "@/lib/variable-manager";

interface HeroSimpleTwoColumnProps {
  data: HeroSimpleTwoColumnType;
}

const DEFAULT_IMAGE_SRC = "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=600&fit=crop";
const DEFAULT_IMAGE_ALT = "Students learning together";

/** Legacy spans when `proportions` / `proportions_percentage` are omitted. */
const DEFAULT_MEDIA_COL = "md:col-span-4 lg:col-span-5";
const DEFAULT_TEXT_COL = "md:col-span-7 lg:col-span-7";

function getGridColClass(proportion: number): string {
  const colMap: Record<number, string> = {
    1: "md:col-span-1",
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
    5: "md:col-span-5",
    6: "md:col-span-6",
    7: "md:col-span-7",
    8: "md:col-span-8",
    9: "md:col-span-9",
    10: "md:col-span-10",
    11: "md:col-span-11",
    12: "md:col-span-12",
  };
  return colMap[proportion] || "md:col-span-6";
}

function stripTitleForMobile(html: string): string {
  return html
    .replace(/font-size\s*:[^;"]*(;)?/gi, "")
    .replace(/<br\s*\/?>/gi, " ");
}

function getTextColumnAlignClass(alignment?: "start" | "center" | "end"): string {
  switch (alignment) {
    case "start":
      return "md:self-start";
    case "end":
      return "md:self-end";
    case "center":
    default:
      return "md:self-center";
  }
}

/** Normalize [a, b] to percentages that sum to 100. */
function normalizePercentagePair(
  raw: unknown,
): { left: number; right: number } | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const a = Number(raw[0]);
  const b = Number(raw[1]);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b < 0) return null;
  const sum = a + b;
  if (sum <= 0) return null;
  return { left: (a / sum) * 100, right: (b / sum) * 100 };
}

export default function HeroSimpleTwoColumn({ data }: HeroSimpleTwoColumnProps) {
  const handleLinkClick = useInternalNav();
  const fullData = data as HeroSimpleTwoColumnType & {
    video?: {
      url: string;
      ratio?: string;
      mobile_ratio?: string;
      muted?: boolean;
      autoplay?: boolean;
      loop?: boolean;
      preview_image_url?: string;
      with_shadow_border?: boolean;
    };
  };
  const video = fullData.video ?? null;

  const imageSrc =
    typeof data.image === "string"
      ? data.image || DEFAULT_IMAGE_SRC
      : data.image?.src || DEFAULT_IMAGE_SRC;
  const imageAlt =
    typeof data.image === "string"
      ? data.image_alt || DEFAULT_IMAGE_ALT
      : data.image?.alt || data.image_alt || DEFAULT_IMAGE_ALT;
  const imageObjectFit = data.image_object_fit || "cover";
  const imageObjectPosition = data.image_object_position || "center";
  const imageFieldPath = typeof data.image === "string" ? "image" : "image.src";

  const mediaAtRight = data.media_at_right === true;
  const pctPair = normalizePercentagePair(data.proportions_percentage);
  const usePercentage = pctPair !== null;

  const proportions = data.proportions;
  const hasProportions =
    !usePercentage &&
    Array.isArray(proportions) &&
    proportions.length >= 2 &&
    typeof proportions[0] === "number" &&
    typeof proportions[1] === "number";

  const leftColClass = usePercentage
    ? "min-w-0"
    : hasProportions
      ? getGridColClass(proportions![0])
      : mediaAtRight
        ? DEFAULT_TEXT_COL
        : DEFAULT_MEDIA_COL;
  const rightColClass = usePercentage
    ? "min-w-0"
    : hasProportions
      ? getGridColClass(proportions![1])
      : mediaAtRight
        ? DEFAULT_MEDIA_COL
        : DEFAULT_TEXT_COL;

  const textAlignClass = getTextColumnAlignClass(data.alignment);

  const gridClass = usePercentage
    ? "grid max-md:grid-cols-1 md:grid-cols-[minmax(0,var(--hero-col-left))_minmax(0,var(--hero-col-right))] gap-12 items-center"
    : "grid md:grid-cols-12 gap-4 lg:gap-12 items-center";

  const gridStyle: CSSProperties | undefined = usePercentage
    ? ({
        ["--hero-col-left" as string]: `${pctPair!.left}%`,
        ["--hero-col-right" as string]: `${pctPair!.right}%`,
      } as CSSProperties)
    : undefined;

  const titleHtml = typeof data.title === "string" ? data.title : "";
  const subtitleHtml = coerceToHtml(data.subtitle);

  const mediaBlock = (opts: { desktopOnly?: boolean; mobileOnly?: boolean; testIdSuffix?: string }) => {
    const wrapClass = [
      opts.desktopOnly ? "hidden md:block" : "",
      opts.mobileOnly ? "md:hidden mt-5" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const suffix = opts.testIdSuffix ?? "";
    const media = video ? (
      <UniversalVideo
        url={video.url}
        ratio={video.ratio || "16:9"}
        mobileRatio={video.mobile_ratio || "16:11"}
        muted={video.muted}
        autoplay={video.autoplay}
        loop={video.loop}
        preview_image_url={video.preview_image_url}
        withShadowBorder={video.with_shadow_border}
        className="w-full"
        data-testid={`video-hero${suffix}`}
      />
    ) : (
      <UniversalImage
        id={imageSrc}
        alt={imageAlt}
        className="w-full h-auto rounded-card shadow-card"
        style={{
          objectFit: imageObjectFit as "cover" | "contain" | "fill",
          objectPosition: imageObjectPosition,
        }}
        fieldContext={{ fieldPath: imageFieldPath }}
        loading="eager"
        data-testid={`img-hero${suffix}`}
      />
    );
    if (opts.desktopOnly || opts.mobileOnly) {
      return <div className={wrapClass}>{media}</div>;
    }
    return media;
  };

  const textBlock = (
    <div className="text-center md:text-left">
      <h1
        className="font-inter font-extrabold text-foreground mb-4 text-center md:text-left [&_em]:text-primary [&_em]:italic"
        data-testid="text-hero-title"
      >
        {/* Mobile: small default; strip RTE font-size so layout stays stable */}
        <div
          className="block md:hidden text-[2rem] leading-none"
          dangerouslySetInnerHTML={{ __html: stripTitleForMobile(titleHtml) }}
        />
        {/* Desktop: modest default; RTE inline font-size / line-height / weight override when set */}
        <div
          className="hidden md:block text-[2.25rem] lg:text-[2.5rem] leading-[1.03]"
          dangerouslySetInnerHTML={{ __html: titleHtml }}
        />
      </h1>
      {subtitleHtml && (
        <RichTextContent
          html={subtitleHtml}
          className="text-muted-foreground text-[0.88rem] md:text-[0.92rem] lg:text-[1.1rem] leading-[1.65] mb-4 font-medium"
          data-testid="text-hero-subtitle"
        />
      )}
      {coerceToText(data.badge) && (
        <span
          className="inline-block bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-4"
          data-testid="text-hero-badge"
        >
          {coerceToText(data.badge)}
        </span>
      )}

      {data.cta_buttons && data.cta_buttons.length > 0 && (
        <div className="flex flex-wrap gap-4 justify-center md:justify-start">
          {data.cta_buttons.map((button, index) => (
            <Button
              key={index}
              variant={button.variant === "primary" ? "default" : button.variant}
              size="lg"
              asChild
              data-testid={`button-hero-cta-${index}`}
            >
              <a href={button.url} onClick={handleLinkClick} className="flex items-center gap-2">
                {button.icon &&
                  (() => {
                    const Ic = getIcon(button.icon);
                    return Ic ? createElement(Ic, { className: "h-4 w-4" }) : null;
                  })()}
                {button.text}
              </a>
            </Button>
          ))}
        </div>
      )}
      {/* Mobile media — always after copy (desktop order controlled by media_at_right) */}
      {mediaBlock({ mobileOnly: true, testIdSuffix: "-mobile" })}
    </div>
  );

  return (
    <section data-testid="section-hero">
      <div className="max-w-6xl mx-auto px-4">
        <div className={gridClass} style={gridStyle}>
          {mediaAtRight ? (
            <>
              <div className={`${leftColClass} ${textAlignClass}`}>{textBlock}</div>
              <div className={`hidden md:block ${rightColClass}`}>
                {mediaBlock({ testIdSuffix: "" })}
              </div>
            </>
          ) : (
            <>
              <div className={`hidden md:block ${leftColClass}`}>
                {mediaBlock({ testIdSuffix: "" })}
              </div>
              <div className={`${rightColClass} ${textAlignClass}`}>{textBlock}</div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
