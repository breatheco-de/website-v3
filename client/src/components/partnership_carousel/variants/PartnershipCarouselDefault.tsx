
import { useState, useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { UniversalImage } from "@/components/UniversalImage";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useInternalNav } from "@/hooks/useInternalNav";
import type {
  PartnershipCarouselSection,
  PartnershipSlide,
} from "@shared/schema";
import { sectionBackgroundStyle } from "@shared/theme-palette";
import { Card } from "@/components/ui/card";

interface PartnershipCarouselProps {
  data: PartnershipCarouselSection;
}

function SlideContent({ slide }: { slide: PartnershipSlide }) {
  const handleLinkClick = useInternalNav();
  return (
    <div className="flex flex-col justify-center gap-4 p-6 md:p-10">
      <h3
        className="text-2xl md:text-4xl font-bold text-foreground"
        data-testid="text-partnership-title"
      >
        {slide.title}
      </h3>

      {slide.description && (
        <p
          className="text-muted-foreground leading-relaxed"
          data-testid="text-partnership-description"
        >
          {slide.description}
        </p>
      )}
      <div className="flex justify-between px-2 items-center">
        {slide.stats && slide.stats.length > 0 && (
          <div className="flex gap-3 mt-2" data-testid="stats-partnership">
            {slide.stats.map((stat, i) => (
              <Card key={i} className="flex flex-col justify-center p-2">
                <span
                  className="text-2xl md:text-4xl font-bold text-primary text-center"
                  data-testid={`text-stat-value-${i}`}
                >
                  {stat.value}
                </span>
                <span
                  className="text-sm text-muted-foreground text-center"
                  data-testid={`text-stat-label-${i}`}
                >
                  {stat.label}
                </span>
              </Card>
            ))}
          </div>
        )}

        {slide.institution_logos && slide.institution_logos.length > 0 && (
          <div className="gap-4 mt-2" data-testid="logos-partnership">
            <div className="text-center mb-1">
              <h3>Institutions that contributed</h3>
            </div>
            <div className="flex">
              {slide.institution_logos.map((logo, i) => (
                <div
                  key={i}
                  className="flex items-center justify-end gap-2 text-sm text-muted-foreground mb-1"
                  style={{ height: logo.logo_height || "50px" }}
                  data-testid={`img-institution-logo-${i}`}
                >
                  <UniversalImage
                    id={logo.image_id}
                    alt={logo.alt}
                    className="h-full w-auto object-contain h-4"
                  />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      {slide.press_references && slide.press_references.length > 0 && (
        <div
          className="flex flex-col gap-2 mt-2"
          data-testid="press-partnership"
        >
          {slide.press_references.map((ref, i) => (
            <div
              key={i}
              className="flex items-start gap-2 text-sm text-muted-foreground"
            >
              {ref.url ? (
                <a
                  href={ref.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2 hover-elevate inline-flex items-center gap-1"
                  data-testid={`link-press-ref-${i}`}
                >
                  {ref.source && (
                    <span className="font-medium">{ref.source}:</span>
                  )}
                  <span>{ref.text}</span>
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                </a>
              ) : (
                <span data-testid={`text-press-ref-${i}`}>
                  {ref.source && (
                    <span className="font-medium">{ref.source}: </span>
                  )}
                  {ref.text}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {slide.cta && (
        <div className="mt-4">
          <a href={slide.cta.url} onClick={handleLinkClick} data-testid="link-partnership-cta">
            <Button
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
        </div>
      )}
    </div>
  );
}

export default function PartnershipCarouselDefault({ data }: PartnershipCarouselProps) {
  const { slides, heading, subtitle, autoplay, autoplay_interval } = data;
  const [activeIndex, setActiveIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [maxContentHeight, setMaxContentHeight] = useState(0);
  const autoplayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isPausedRef = useRef(false);
  const contentRefs = useRef<(HTMLDivElement | null)[]>([]);

  const totalSlides = slides.length;

  useEffect(() => {
    const measureContent = () => {
      let tallest = 0;
      contentRefs.current.forEach((el) => {
        if (el) {
          tallest = Math.max(tallest, el.scrollHeight);
        }
      });
      if (tallest > 0) setMaxContentHeight(tallest);
    };

    measureContent();

    const observer = new ResizeObserver(measureContent);
    contentRefs.current.forEach((el) => {
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [slides]);

  const goTo = (index: number) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setActiveIndex(((index % totalSlides) + totalSlides) % totalSlides);
    setTimeout(() => setIsTransitioning(false), 400);
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

  const currentSlide = slides[activeIndex];

  if (!currentSlide) return null;

  return (
    <section
      className="w-full"
      style={sectionBackgroundStyle(data.background)}
      data-testid="section-partnership-carousel"
      onMouseEnter={handlePause}
      onMouseLeave={handleResume}
    >
      <div>
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

          <div className="rounded-[0.8rem] overflow-hidden border border-border bg-card">
            <div
              className="relative overflow-hidden"
              style={{
                height: maxContentHeight > 0 ? `${maxContentHeight}px` : "auto",
              }}
            >
              <div
                className="flex transition-transform duration-500 ease-in-out h-full"
                style={{ transform: `translateX(-${activeIndex * 100}%)` }}
              >
                {slides.map((slide, i) => (
                  <div
                    key={i}
                    className="w-full flex-shrink-0 grid grid-cols-1 md:grid-cols-12 h-full"
                  >
                    <div className="relative overflow-hidden md:col-span-5 aspect-[4/3] md:aspect-auto">
                      <UniversalImage
                        id={slide.image_id}
                        className="w-full h-full"
                        style={{
                          objectFit:
                            (slide.object_fit as React.CSSProperties["objectFit"]) ||
                            "cover",
                          objectPosition: slide.object_position || "center",
                        }}
                        data-testid={`img-partnership-slide-${i}`}
                        fieldContext={{ arrayPath: "slides", index: i, srcField: "image_id" }}
                      />
                    </div>
                    <div
                      ref={(el) => {
                        contentRefs.current[i] = el;
                      }}
                      className="flex flex-col justify-start md:col-span-7"
                    >
                      <SlideContent slide={slide} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {totalSlides > 1 && (
            <div className="flex items-center justify-between mt-6 px-2">
              <Button
                size="icon"
                variant="outline"
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
                variant="outline"
                onClick={goToNext}
                disabled={isTransitioning}
                data-testid="button-carousel-next"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
