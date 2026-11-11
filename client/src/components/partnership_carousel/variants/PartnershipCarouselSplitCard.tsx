
import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { UniversalImage } from "@/components/UniversalImage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  PartnershipCarouselSection,
  PartnershipSlide,
} from "@shared/schema";
import { Card } from "@/components/ui/card";
import { useInternalNav } from "@/hooks/useInternalNav";
import { sectionBackgroundStyle } from "@shared/theme-palette";

interface PartnershipCarouselProps {
  data: PartnershipCarouselSection;
}

function TruncatedDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [needsTruncation, setNeedsTruncation] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    setNeedsTruncation(el.scrollHeight > lineHeight * 5 + 2);
  }, [text]);

  return (
    <div>
      <p
        ref={textRef}
        className={cn(
          "text-muted-foreground leading-relaxed text-sm",
          !expanded && "line-clamp-5 lg:line-clamp-none",
        )}
        data-testid="text-partnership-description"
      >
        {text}
      </p>
      {needsTruncation && !expanded && (
        <button
          onClick={() => setExpanded(true)}
          className="text-primary text-sm font-medium mt-1 lg:hidden"
          data-testid="button-see-more"
        >
          See more
        </button>
      )}
      {needsTruncation && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="text-primary text-sm font-medium mt-1 lg:hidden"
          data-testid="button-see-less"
        >
          See less
        </button>
      )}
    </div>
  );
}

function SlideLeftCard({
  slide,
  verticalCards = false,
  slideIndex,
}: {
  slide: PartnershipSlide;
  verticalCards?: boolean;
  slideIndex: number;
}) {
  const handleLinkClick = useInternalNav();
  return (
    <Card
      className={cn(
        "flex flex-col h-full",
        verticalCards && "lg:flex-row",
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-t-[0.8rem]",
          "min-h-[200px] md:h-[200px] aspect-[16/9] md:aspect-[16/5] lg:md-aspect-[16/6]",
          verticalCards && "lg:min-h-[400px] lg:w-[53%] lg:rounded-t-none lg:rounded-l-[0.8rem] lg:aspect-auto",
        )}
      >
        <UniversalImage
          id={slide.image_id}
          className="w-full h-full"
          style={{
            objectFit:
              (slide.object_fit as React.CSSProperties["objectFit"]) || "cover",
            objectPosition: slide.object_position || "center",
          }}
          data-testid="img-partnership-slide"
          fieldContext={{ arrayPath: "slides", index: slideIndex, srcField: "image_id" }}
        />
      </div>

      <div className="flex flex-col gap-2 md:gap-4 p-6 flex-1">
        <h3
          className="text-2xl md:text-3xl font-bold text-foreground"
          data-testid="text-partnership-title"
        >
          {slide.title}
        </h3>

        {slide.description && (
          <TruncatedDescription text={slide.description} />
        )}
        <div className="flex flex-col justify-end h-full">
          {slide.stats && slide.stats.length > 0 && (
            <div className="flex justify-center">
              <div
                className={`grid ${slide.stats.length > 2 ? "sm:grid-cols-3" : "sm:grid-cols-2"} grid-cols-2 gap-3 mt-auto`}
                data-testid="stats-partnership"
              >
                {slide.stats.map((stat, i) => (
                  <Card
                    key={i}
                    className="flex flex-col items-center justify-center p-3"
                  >
                    <span
                      className="text-2xl md:text-3xl font-bold text-primary"
                      data-testid={`text-stat-value-${i}`}
                    >
                      {stat.value}
                    </span>
                    <span
                      className="text-xs text-muted-foreground text-center"
                      data-testid={`text-stat-label-${i}`}
                    >
                      {stat.label}
                    </span>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {slide.cta && (
            <a
              href={slide.cta.url}
              className="mt-3 w-full"
              data-testid="link-partnership-cta"
            >
              <Button
                className="w-full"
                variant={
                  slide.cta.variant === "outline"
                    ? "outline"
                    : slide.cta.variant === "secondary"
                      ? "secondary"
                      : slide.cta.variant === "accent"
                        ? "accent"
                        : "default"
                }
              >
                <a href={slide.cta.url} onClick={handleLinkClick}>{slide.cta.text}</a>
              </Button>
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}

function SlideRightCard({
  slide,
  institutionsHeading,
  referencesHeading,
}: {
  slide: PartnershipSlide;
  institutionsHeading?: string;
  referencesHeading?: string;
}) {
  const hasInstitutions =
    slide.institution_logos && slide.institution_logos.length > 0;
  const hasReferences =
    slide.press_references && slide.press_references.length > 0;

  if (!hasInstitutions && !hasReferences) return null;

  return (
    <Card className="flex flex-col h-full p-6 gap-6">
      {hasInstitutions && (
        <div className="flex flex-col gap-3">
          <h4
            className="text-base font-bold text-foreground"
            data-testid="text-institutions-heading"
          >
            {institutionsHeading || "Institutions that contributed to this project"}
          </h4>
          <div
            className="flex gap-3"
            data-testid="logos-partnership"
          >
            {slide.institution_logos!.map((logo, i) => (
              <Card
                key={i}
                className="flex items-center justify-center p-1"
                data-testid={`card-institution-logo-${i}`}
              >
                <div
                  className="flex items-center justify-center"
                  style={{ height: logo.logo_height || "40px" }}
                >
                  <UniversalImage
                    id={logo.image_id}
                    alt={logo.alt}
                    className="h-full w-auto object-contain"
                    data-testid={`img-institution-logo-${i}`}
                  />
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}

      {hasReferences && (
        <div className="flex flex-col gap-3">
          <h4
            className="text-base font-bold text-foreground"
            data-testid="text-references-heading"
          >
            {referencesHeading || "References"}
          </h4>
          <div className="flex flex-col gap-3" data-testid="press-partnership">
            {slide.press_references!.map((ref, i) => {
              const wrapper = ref.url ? "a" : "div";
              const linkProps = ref.url
                ? {
                    href: ref.url,
                    target: "_blank",
                    rel: "noopener noreferrer",
                  }
                : {};

              const Tag = wrapper as keyof JSX.IntrinsicElements;

              return (
                <Tag
                  key={i}
                  {...linkProps}
                  className={cn(
                    "flex items-start gap-3",
                    ref.url && "hover-elevate",
                  )}
                  data-testid={ref.url ? `link-press-ref-${i}` : `text-press-ref-${i}`}
                >
                  <ExternalLink className="w-4 h-4 flex-shrink-0 mt-0.5 text-foreground" />
                  <div className="flex flex-col">
                    {ref.source && (
                      <span className="text-sm font-bold text-foreground">
                        {ref.source}
                      </span>
                    )}
                    {ref.text && (
                      <span className="text-xs text-muted-foreground">
                        {ref.text}
                      </span>
                    )}
                  </div>
                </Tag>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

function SlideContent({
  slide,
  verticalCards = false,
  institutionsHeading,
  referencesHeading,
  slideIndex,
}: {
  slide: PartnershipSlide;
  verticalCards?: boolean;
  institutionsHeading?: string;
  referencesHeading?: string;
  slideIndex: number;
}) {
  const hasRightCard =
    (slide.institution_logos && slide.institution_logos.length > 0) ||
    (slide.press_references && slide.press_references.length > 0);

  return (
    <div
      className={cn(
        "grid gap-6",
        hasRightCard ? "grid-cols-1 lg:grid-cols-12" : "grid-cols-1",
      )}
    >
      <div
        className={
          hasRightCard
            ? `${verticalCards ? "lg:col-span-9" : "lg:col-span-8"}`
            : ""
        }
      >
        <SlideLeftCard slide={slide} verticalCards={verticalCards} slideIndex={slideIndex} />
      </div>

      {hasRightCard && (
        <div className={`${verticalCards ? "lg:col-span-3" : "lg:col-span-4"}`}>
          <SlideRightCard
            slide={slide}
            institutionsHeading={institutionsHeading}
            referencesHeading={referencesHeading}
          />
        </div>
      )}
    </div>
  );
}

export default function PartnershipCarouselSplitCard({
  data,
}: PartnershipCarouselProps) {
  const {
    slides,
    heading,
    subtitle,
    autoplay,
    autoplay_interval,
    vertical_cards,
  } = data;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [activeHeight, setActiveHeight] = useState<number>(0);
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(false);
  const slideRefs = useRef<(HTMLDivElement | null)[]>([]);

  const totalSlides = slides.length;

  useEffect(() => {
    requestAnimationFrame(() => {
      const el = slideRefs.current[activeIndex];
      if (el) {
        setActiveHeight(el.scrollHeight);
      }
    });
  }, [activeIndex, slides]);

  useEffect(() => {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const onResize = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        const el = slideRefs.current[activeIndex];
        if (el) setActiveHeight(el.scrollHeight);
      }, 150);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [activeIndex]);

  const goTo = (index: number) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setActiveIndex(((index % totalSlides) + totalSlides) % totalSlides);
    setTimeout(() => setIsTransitioning(false), 500);
  };

  const goToPrevious = () => goTo(activeIndex - 1);
  const goToNext = () => goTo(activeIndex + 1);

  useEffect(() => {
    if (!autoplay || totalSlides <= 1) return;

    const startAutoplay = () => {
      autoplayRef.current = setInterval(() => {
        if (!isPausedRef.current) {
          setActiveIndex((prev) => (prev + 1) % totalSlides);
        }
      }, autoplay_interval || 5000);
    };

    startAutoplay();
    return () => {
      if (autoplayRef.current) clearInterval(autoplayRef.current);
    };
  }, [autoplay, autoplay_interval, totalSlides]);

  const handlePause = () => {
    isPausedRef.current = true;
  };
  const handleResume = () => {
    isPausedRef.current = false;
  };

  const carouselNav = (() => {
    if (totalSlides <= 1) return null;
    return (
      <div className="flex items-center justify-between px-2">
        <Button
          size="icon"
          variant="ghost"
          className="rounded-full"
          onClick={goToPrevious}
          disabled={isTransitioning}
          data-testid="button-carousel-prev"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>

        <div
          className="flex items-center gap-2"
          data-testid="dots-carousel"
        >
          {slides.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={cn(
                "rounded-full transition-all duration-300",
                i === activeIndex
                  ? "w-8 h-2 bg-primary"
                  : "w-2 h-2 bg-muted-foreground/30 hover-elevate",
              )}
              data-testid={`button-carousel-dot-${i}`}
            />
          ))}
        </div>

        <Button
          size="icon"
          variant="ghost"
          className="rounded-full"
          onClick={goToNext}
          disabled={isTransitioning}
          data-testid="button-carousel-next"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>
    );
  })();

  return (
    <section
      className="w-full"
      style={sectionBackgroundStyle(data.background)}
      data-testid="section-partnership-carousel"
      onMouseEnter={handlePause}
      onMouseLeave={handleResume}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8">
        {(heading || subtitle) && (
          <div className="text-center mb-10">
            {heading && (
              <h2
                className="text-3xl md:text-4xl font-bold text-foreground mb-3"
                data-testid="text-carousel-heading"
              >
                {heading}
              </h2>
            )}
            {subtitle && (
              <p
                className="text-lg text-muted-foreground max-w-2xl mx-auto"
                data-testid="text-carousel-subtitle"
              >
                {subtitle}
              </p>
            )}
          </div>
        )}

        <div className="lg:hidden mb-4">{carouselNav}</div>

        <div
          className="relative overflow-hidden transition-[height] duration-500 ease-in-out"
          style={{ height: activeHeight > 0 ? `${activeHeight}px` : "auto" }}
        >
          <div
            className="flex items-start transition-transform duration-500 ease-in-out"
            style={{ transform: `translateX(-${activeIndex * 100}%)` }}
          >
            {slides.map((slide, i) => (
              <div
                key={i}
                className="w-full flex-shrink-0"
              >
                <div ref={(el) => { slideRefs.current[i] = el; }}>
                  <SlideContent
                    slide={slide}
                    verticalCards={vertical_cards}
                    institutionsHeading={data.institutions_heading}
                    referencesHeading={data.references_heading}
                    slideIndex={i}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="hidden lg:block mt-6">{carouselNav}</div>
      </div>
    </section>
  );
}
