
import { useState, useEffect, lazy, Suspense } from "react";
import { ArrowRight, Check, Star } from "lucide-react";
import { CSSMarquee } from "@/components/ui/CSSMarquee";
import type {
  HeroProductShowcase as HeroProductShowcaseType,
  HeroApplyFormProductShowcase,
} from "@shared/schema";
import { UniversalVideo } from "@/components/UniversalVideo";
import { UniversalImage } from "@/components/UniversalImage";
import { Button } from "@/components/ui/button";
import { resolveTemplateFallback } from "@/lib/variable-manager";
import type { LeadFormData } from "@shared/schema";
import { AwardsMarquee } from "@/components/awards_marquee/variants/AwardsMarqueeDefault";
import { useInternalNav } from "@/hooks/useInternalNav";
import { Card } from "@/components/ui/card";
import { RichTextContent } from "@/components/ui/rich-text-content";

const LeadForm = lazy(() => import("@/components/lead_form/variants/LeadFormDefault"));

function LeadFormFallback() {
  return (
    <div className="min-h-24 flex items-center justify-center text-muted-foreground text-sm">
      Loading...
    </div>
  );
}

function parseLogoHeight(value?: string): number | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : undefined;
}

interface HeroProductShowcaseProps {
  data: HeroProductShowcaseType | HeroApplyFormProductShowcase;
  landingLocations?: string[];
}

export default function HeroProductShowcase({
  data,
  landingLocations,
}: HeroProductShowcaseProps) {
  // Hide background image on screens smaller than 1280px for better mobile experience
  const [showBackground, setShowBackground] = useState(false);

  useEffect(() => {
    const checkWidth = () => {
      setShowBackground(window.innerWidth >= 1280);
    };

    checkWidth();
    window.addEventListener("resize", checkWidth);
    return () => window.removeEventListener("resize", checkWidth);
  }, []);

  const handleLinkClick = useInternalNav();

  // Cast to the full type to access optional properties
  const fullData = data as HeroProductShowcaseType;

  // Safely access properties that may not exist on all variants
  const backgroundImage = fullData.background_image ?? null;
  const welcomeText = fullData.welcome_text ?? null;
  const subtitle = fullData.subtitle ?? null;
  const video = fullData.video ?? null;
  const rawImage = fullData.image ?? null;
  const imageSrc =
    typeof rawImage === "string" ? rawImage : (rawImage?.src ?? null);
  const imageAlt =
    typeof rawImage === "string"
      ? (fullData.image_alt ?? "")
      : (rawImage?.alt ?? "");
  const imageObjectFit = (fullData as any).image_object_fit as
    | string
    | undefined;
  const imageObjectPosition = (fullData as any).image_object_position as
    | string
    | undefined;
  const hasMedia = !!(video?.url || imageSrc);
  const formVerticalAlign = (fullData as any).form_vertical_align as
    | string
    | undefined;
  const marquee = fullData.marquee ?? null;
  const bullets = fullData.bullets ?? null;
  const leftImages = fullData.left_images ?? null;
  const rightImages = fullData.right_images ?? null;
  const hasDecorativeImages =
    (leftImages && leftImages.length > 0) ||
    (rightImages && rightImages.length > 0);
  const showAwardsMarquee = (fullData as any).show_awards_marquee === true;
  const awardsMarqueeAtLeft = (fullData as any).awards_marquee_at_left_column === true;
  const awardsMarquee = (fullData as any).awards_marquee as
    | {
        items?: any[];
        speed?: number;
        gradient?: boolean;
        gradientWidth?: number;
      }
    | undefined;

  const shouldShowBackground = backgroundImage && showBackground;

  const formCardBackground = (fullData as any).form_card_background as string | undefined;
  const formCardTextColor = (fullData as any).form_card_text_color as string | undefined;
  const formCardFinePrintColor = formCardTextColor || data.form_terms_color;
  const formCardFinePrintStyle = formCardFinePrintColor ? { color: formCardFinePrintColor } : undefined;
  const formCardTitle = (fullData as any).form_card_title as string | undefined;
  const formCardSubtitle = (fullData as any).form_card_subtitle as string | undefined;
  const rawFormCardImage = (fullData as any).form_card_image;
  const formCardImageSrc = typeof rawFormCardImage === "string"
    ? rawFormCardImage
    : (rawFormCardImage?.src ?? null);
  const formCardImageAlt = (fullData as any).form_card_image_alt as string | undefined
    || (typeof rawFormCardImage === "object" && rawFormCardImage?.alt) || "";
  const formCardImageObjectFit = (fullData as any).form_card_image_object_fit as string | undefined;
  const formCardImageObjectPosition = (fullData as any).form_card_image_object_position as string | undefined;
  const formCardImageWidth = (fullData as any).form_card_image_width as string | undefined;
  const formCardImageHeight = (fullData as any).form_card_image_height as string | undefined;
  const formCardImageOpacity = (fullData as any).form_card_image_opacity as number | undefined;
  const formCardImageBorderRadius = (fullData as any).form_card_image_border_radius as string | undefined;

  const formCardBgStyle: React.CSSProperties = {};
  if (formCardBackground) {
    if (formCardBackground.startsWith("linear-gradient") || formCardBackground.startsWith("radial-gradient")) {
      formCardBgStyle.backgroundImage = formCardBackground;
    } else {
      formCardBgStyle.backgroundColor = formCardBackground;
    }
  }
  const colorMap: Record<string, string> = {
    primary: "hsl(var(--primary))",
    accent: "hsl(var(--accent))",
    destructive: "hsl(var(--destructive))",
    "chart-1": "hsl(var(--chart-1))",
    "chart-2": "hsl(var(--chart-2))",
    "chart-3": "hsl(var(--chart-3))",
    "chart-4": "hsl(var(--chart-4))",
    "chart-5": "hsl(var(--chart-5))",
  };

  return (
    <section
      id="hero-form"
      className="relative overflow-hidden"
      style={
        shouldShowBackground
          ? {
              backgroundImage: `url(${backgroundImage!.src})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }
          : undefined
      }
      data-testid="section-hero"
    >
      {/* Left decorative images - only shown on xl screens when images exist */}
      {hasDecorativeImages && leftImages && leftImages.length > 0 && (
        <div className="absolute left-0 top-0 h-full w-[200px] hidden xl:block pointer-events-none z-0">
          <div className="relative h-full">
            {leftImages.map((image, index) => (
              <div
                key={index}
                className={`absolute w-44 transform transition-transform duration-brand ease-brand hover:rotate-0 hover:scale-[1.02] pointer-events-auto ${
                  index === 0
                    ? "top-[80px] left-4 -rotate-6"
                    : "top-[240px] left-12 rotate-3"
                }`}
                style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.15)" }}
                data-testid={`img-hero-left-${index}`}
              >
                <UniversalImage
                  id={image.src}
                  alt={image.alt}
                  className="w-full h-40 rounded-lg"
                  loading={index === 0 ? "eager" : "lazy"}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Right decorative images - only shown on xl screens when images exist */}
      {hasDecorativeImages && rightImages && rightImages.length > 0 && (
        <div className="absolute right-0 top-0 h-full w-[200px] hidden xl:block pointer-events-none z-0">
          <div className="relative h-full">
            {rightImages.map((image, index) => (
              <div
                key={index}
                className={`absolute w-44 transform transition-transform duration-brand ease-brand hover:rotate-0 hover:scale-[1.02] pointer-events-auto ${
                  index === 0
                    ? "top-[80px] right-4 rotate-6"
                    : "top-[240px] right-12 -rotate-3"
                }`}
                style={{ boxShadow: "0 10px 30px rgba(0,0,0,0.15)" }}
                data-testid={`img-hero-right-${index}`}
              >
                <UniversalImage
                  id={image.src}
                  alt={image.alt}
                  className="w-full h-40 rounded-lg"
                  loading={index === 0 ? "eager" : "lazy"}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="max-w-6xl mx-auto px-4 relative z-10">
        <div className="grid md:grid-cols-5 gap-3 md:gap-16 items-start">
          <div className="md:col-span-3 flex flex-col items-center md:items-start justify-start min-w-0">
            <div className="text-center md:text-left relative w-full min-w-0 pl-[0px] pr-[0px] mt-[24px] mb-[24px]">
              {welcomeText && (
                <p className="text-4xl text-muted-foreground">{welcomeText}</p>
              )}

              {data.brand_mark && (
                <h1 className="font-heading text-4xl md:text-h1 tracking-tight">
                  {data.brand_mark.prefix && (
                    <span className="text-foreground">
                      <span
                        dangerouslySetInnerHTML={{
                          __html: `${data.brand_mark.prefix} `,
                        }}
                      />
                    </span>
                  )}
                  <span
                    style={{
                      color: colorMap[data.brand_mark.color || "primary"],
                    }}
                    dangerouslySetInnerHTML={{
                      __html: data.brand_mark.highlight || "",
                    }}
                  >
                  </span>
                  {data.brand_mark.suffix && (
                    <span className="text-foreground">
                      {" "}
                      {data.brand_mark.suffix}
                    </span>
                  )}
                </h1>
              )}
              <h2
                className="text-4xl lg:text-5xl font-medium text-foreground mb-3 md:mb-0"
                data-testid="text-hero-title"
                dangerouslySetInnerHTML={{ __html: data.title || "" }}
              />

              {subtitle && (
                <p
                  className="text-4xl text-muted-foreground mb-8 max-w-xl leading-[42px] mt-3"
                  data-testid="text-hero-subtitle"
                >
                  {subtitle}
                </p>
              )}

              {data.description && (
                <div className="relative">
                  <RichTextContent
                    html={data.description}
                    className="text-body text-foreground mt-2 mb-0 md:mb-8 md:max-w-xl leading-relaxed [&_p]:mb-0"
                    data-testid="text-hero-description"
                  />
                </div>
              )}

              {bullets && bullets.length > 0 && (
                <div className="flex justify-center md:block">
                  <ul
                    className="mt-3 md:mb-4 space-y-1 max-w-xl"
                    data-testid="hero-bullets"
                  >
                    {bullets.map((bullet, index) => (
                      <li
                        key={index}
                        className="flex items-start gap-1 md:gap-3 text-foreground"
                        data-testid={`hero-bullet-${index}`}
                      >
                        <Check className="h-5 w-5 mt-0.5 text-primary flex-shrink-0" />
                        <span className="text-body leading-relaxed text-left">
                          {bullet.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {data.footer && (
                <div className="relative">
                  <RichTextContent
                    html={data.footer}
                    className="text-sm text-muted-foreground leading-relaxed [&_p]:mb-0"
                    data-testid="text-hero-footer"
                  />
                </div>
              )}

              {marquee && marquee.items && marquee.items.length > 0 && (
                <div
                  className="w-full max-w-xl mt-6 md:mb-8 overflow-hidden"
                  data-testid="hero-embedded-marquee"
                >
                  <CSSMarquee
                    speed={marquee.speed || 40}
                    gradient={marquee.gradient ?? true}
                    gradientWidth={marquee.gradientWidth || 60}
                  >
                    {marquee.items.map((item, index) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-center mx-4 transition-opacity duration-brand ease-brand hover:opacity-80"
                        data-testid={`hero-marquee-item-${index}`}
                      >
                        {item.logo ? (
                          <div style={{ height: parseLogoHeight(item.logoHeight) || 48 }} className="flex items-center">
                            <UniversalImage
                              id={item.logo}
                              alt={item.alt}
                              className="h-full w-auto"
                              style={{ objectFit: "contain" }}
                              fieldContext={{ arrayPath: "marquee.items", index, srcField: "logo" }}
                            />
                          </div>
                        ) : (
                          <div className="flex flex-col items-center text-center">
                            <span className="text-xs text-muted-foreground uppercase tracking-wide">
                              {item.source} {item.year && `${item.year}`}
                            </span>
                            <span className="text-sm font-medium text-foreground mt-0.5">
                              {item.name}
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </CSSMarquee>
                </div>
              )}

              {data.form && hasMedia && (
                <div
                  data-hero-inline-form
                  className="hidden md:flex mt-2 mb-8 justify-center md:justify-start"
                >
                  <Suspense fallback={<LeadFormFallback />}>
                    <LeadForm
                      data={
                        {
                          ...data.form,
                          variant: data.form.variant || "inline",
                          consent: data.form.consent,
                          show_terms: data.form.show_terms ?? true,
                          className: "w-full max-w-md",
                        } as LeadFormData
                      }
                      landingLocations={landingLocations}
                      termsStyle={data.form_terms_color ? { color: data.form_terms_color } : undefined}
                    />
                  </Suspense>
                </div>
              )}

              {data.cta_button && !data.form && (
                <div className="mt-2 mb-8">
                  <Button
                    variant={
                      data.cta_button.variant === "outline"
                        ? "outline"
                        : "default"
                    }
                    size="lg"
                    asChild
                    data-testid="button-hero-cta"
                  >
                    <a href={data.cta_button.url} onClick={handleLinkClick}>
                      {data.cta_button.text}
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </a>
                  </Button>
                </div>
              )}

              {data.trust_bar && (
                <div className="flex justify-center md:justify-start">
                  <div className="inline-flex flex-wrap items-center gap-4 text-sm text-muted-foreground bg-muted/50 rounded-card px-4 py-3 transition-all duration-brand ease-brand">
                    <div className="flex flex-col gap-1">
                      {data.trust_bar.rating && (
                        <div className="flex items-center gap-1">
                          <div className="flex">
                            {[1, 2, 3, 4, 5].map((star) => {
                              const rating = parseFloat(
                                resolveTemplateFallback(
                                  data.trust_bar!.rating || "0",
                                ),
                              );
                              const fullStars = Math.floor(rating);
                              const hasHalf = rating % 1 >= 0.5;
                              const isHalfStar =
                                hasHalf && star === fullStars + 1;

                              if (star <= fullStars) {
                                return (
                                  <Star
                                    key={star}
                                    className="fill-current h-6 w-6 text-yellow-500"
                                  />
                                );
                              } else if (isHalfStar) {
                                return (
                                  <div key={star} className="relative h-6 w-6">
                                    <Star className="fill-current h-6 w-6 text-muted" />
                                    <div
                                      className="absolute inset-0 overflow-hidden"
                                      style={{ width: "50%" }}
                                    >
                                      <Star className="fill-current h-6 w-6 text-yellow-500" />
                                    </div>
                                  </div>
                                );
                              } else {
                                return (
                                  <Star
                                    key={star}
                                    className="fill-current h-6 w-6 text-muted"
                                  />
                                );
                              }
                            })}
                          </div>
                        </div>
                      )}
                      {data.trust_bar.review_count && (
                        <span className="text-[12px] font-bold">
                          {String(data.trust_bar.review_count)}
                        </span>
                      )}
                    </div>
                    {data.trust_bar.review_logos &&
                      data.trust_bar.review_logos.length > 0 && (
                        <div className="flex items-center gap-3">
                          {data.trust_bar.review_logos.map((logo, index) =>
                            logo.logo ? (
                              <UniversalImage
                                key={index}
                                id={logo.logo}
                                alt={logo.name}
                                className="h-10"
                                style={{ objectFit: "contain" }}
                                fieldContext={{ arrayPath: "trust_bar.review_logos", index, srcField: "logo" }}
                                data-testid={`img-review-logo-${index}`}
                              />
                            ) : (
                              <span
                                key={index}
                                className="font-medium text-foreground"
                                data-testid={`text-review-logo-${index}`}
                              >
                                {logo.name}
                              </span>
                            ),
                          )}
                        </div>
                      )}
                  </div>
                </div>
              )}

              {showAwardsMarquee && awardsMarqueeAtLeft && awardsMarquee?.items && awardsMarquee.items.length > 0 && (
                <div className="w-full max-w-xl mt-6 overflow-hidden" data-testid="hero-awards-marquee-left">
                  <AwardsMarquee
                    data={{
                      className: "!px-0",
                      items: awardsMarquee.items,
                      speed: awardsMarquee.speed,
                      gradient: awardsMarquee.gradient,
                      gradientWidth: awardsMarquee.gradientWidth,
                    }}
                  />
                </div>
              )}
            </div>
          </div>

          <div
            className={`md:col-span-2 w-full md:w-auto min-w-0 flex justify-center md:justify-start ${!hasMedia && formVerticalAlign === "center" ? "items-center h-full" : !hasMedia && formVerticalAlign === "bottom" ? "items-end h-full" : "items-start"}`}
          >
            {video && video.url ? (
              <UniversalVideo
                url={video.url}
                ratio={video.ratio || "16:9"}
                mobileRatio={video.mobile_ratio || "16:11"}
                muted={video.muted}
                autoplay={video.autoplay}
                loop={video.loop}
                preview_image_url={video.preview_image_url}
                withShadowBorder={video.with_shadow_border}
                open_modal_on_click={video.open_modal_on_click}
                show_controls_on_autoplay={video.show_controls_on_autoplay === true}
                overlay_on_muted={video.overlay_on_muted}
                className="w-[280px] md:w-full md:max-w-[400px]"
              />
            ) : imageSrc ? (
              <div className="min-w-0">
                <UniversalImage
                  id={imageSrc}
                  alt={imageAlt}
                  className="w-full max-w-[500px] rounded-card shadow-card"
                  style={{
                    ...(imageObjectFit
                      ? { objectFit: imageObjectFit as any }
                      : {}),
                    ...(imageObjectPosition
                      ? { objectPosition: imageObjectPosition }
                      : {}),
                  }}
                  data-testid="img-hero-product"
                  fieldContext={{ fieldPath: "image" }}
                />
                {showAwardsMarquee && !awardsMarqueeAtLeft &&
                  awardsMarquee?.items &&
                  awardsMarquee.items.length > 0 && (
                    <div
                      className="mt-8 w-full"
                      data-testid="hero-awards-marquee"
                    >
                      <AwardsMarquee
                        data={{
                          items: awardsMarquee.items,
                          speed: awardsMarquee.speed,
                          gradient: awardsMarquee.gradient,
                          gradientWidth: awardsMarquee.gradientWidth,
                        }}
                      />
                    </div>
                  )}
              </div>
            ) : data.form ? (
              <div 
                className={`relative w-full ${formCardImageSrc ? "md:mt-16" : ""}`} 

              >
                <div className="">
                  {formCardImageSrc && (
                    <div
                      className="hidden md:block absolute flex items-center md:top-0 right-9 sm:right-16 md:right-7 lg:right-8 xl:right-0 pointer-events-none z-0  z-[1001]"
                      style={{ transform: "translate(40%, -40%)",
                            }}

                      data-testid="img-form-card-image"
                    >
                      <UniversalImage
                        id={formCardImageSrc}
                        alt={formCardImageAlt}
                        style={{
                          objectFit: (formCardImageObjectFit as React.CSSProperties["objectFit"]) || "contain",
                          objectPosition: formCardImageObjectPosition || "top right",
                          width: formCardImageWidth || "140px",
                          height: formCardImageHeight || "140px",
                          opacity: formCardImageOpacity ?? 1,
                          borderRadius: formCardImageBorderRadius || undefined,
                        }}
                        fieldContext={{ fieldPath: "form_card_image" }}
                      />
                    </div>
                  )}
                </div>
                <Card
                  className={`hidden md:block w-full overflow-hidden p-4 rounded-lg ${formCardBackground ? '' : 'bg-background'}`}
                  style={formCardBgStyle}
                  data-testid="hero-form-right"
                >
                  <div className="relative z-[1]">
                    {(formCardTitle || formCardSubtitle) && (
                      <div className="mb-3" style={formCardTextColor ? { color: formCardTextColor } : undefined}>
                        {formCardTitle && (
                          <h3
                            className="text-3xl mb-2 font-semibold"
                            data-testid="text-form-card-title"
                          >
                            {formCardTitle}
                          </h3>
                        )}
                        {formCardSubtitle && (
                          <p style={{ opacity: 0.8 }}>
                            {formCardSubtitle}
                          </p>
                        )}
                      </div>
                    )}
                    <Suspense fallback={<LeadFormFallback />}>
                      <LeadForm
                        data={
                          {
                            ...data.form,
                            variant: data.form.variant || "stacked",
                            consent: data.form.consent,
                            show_terms: data.form.show_terms ?? true,
                            className: "w-full",
                          } as LeadFormData
                        }
                        landingLocations={landingLocations}
                        termsStyle={formCardFinePrintStyle}
                      />
                    </Suspense>
                  </div>
                </Card>
                {showAwardsMarquee && !awardsMarqueeAtLeft &&
                  awardsMarquee?.items &&
                  awardsMarquee.items.length > 0 && (
                    <div
                      className="mt-8 w-full"
                      data-testid="hero-awards-marquee"
                    >
                      <AwardsMarquee
                        data={{
                          items: awardsMarquee.items,
                          speed: awardsMarquee.speed,
                          gradient: awardsMarquee.gradient,
                          gradientWidth: awardsMarquee.gradientWidth,
                        }}
                      />
                    </div>
                  )}
              </div>
            ) : null}
          </div>

          {data.form && (
            <div className="md:hidden mt-4 flex justify-center w-full">
              <Card
                className={`w-full max-w-md overflow-hidden p-4 rounded-lg ${formCardBackground ? '' : 'bg-background'}`}
                style={formCardBgStyle}
                data-testid="hero-form-mobile"
              >
                {formCardImageSrc && (
                  <div className="flex justify-center mb-4" data-testid="img-form-card-image-mobile">
                    <UniversalImage
                      id={formCardImageSrc}
                      alt={formCardImageAlt}
                      style={{
                        objectFit: (formCardImageObjectFit as React.CSSProperties["objectFit"]) || "contain",
                        width: formCardImageWidth || "140px",
                        height: formCardImageHeight || "140px",
                        opacity: formCardImageOpacity ?? 1,
                        borderRadius: formCardImageBorderRadius || undefined,
                      }}
                      fieldContext={{ fieldPath: "form_card_image" }}
                    />
                  </div>
                )}
                {(formCardTitle || formCardSubtitle) && (
                  <div className="mb-3" style={formCardTextColor ? { color: formCardTextColor } : undefined}>
                    {formCardTitle && (
                      <h3 className="text-2xl mb-2 font-semibold text-center" data-testid="text-form-card-title-mobile">
                        {formCardTitle}
                      </h3>
                    )}
                    {formCardSubtitle && (
                      <p className="text-center" style={{ opacity: 0.8 }}>
                        {formCardSubtitle}
                      </p>
                    )}
                  </div>
                )}
                <Suspense fallback={<LeadFormFallback />}>
                  <LeadForm
                    data={
                      {
                        ...data.form,
                        variant: data.form.variant || "stacked",
                        consent: data.form.consent,
                        show_terms: data.form.show_terms ?? true,
                        className: "w-full",
                      } as LeadFormData
                    }
                    landingLocations={landingLocations}
                    termsStyle={formCardFinePrintStyle}
                  />
                </Suspense>
              </Card>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
