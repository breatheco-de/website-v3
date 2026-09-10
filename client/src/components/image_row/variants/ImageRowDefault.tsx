
import { useState, useEffect, useRef } from "react";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { hasHtmlTags, getTextLength, sliceHtml } from "@/lib/htmlTypewriter";
import { useTypewriter } from "@/hooks/useTypewriter";
import { UniversalImage } from "@/components/UniversalImage";
import { useSectionContext } from "@/contexts/SectionContext";
import type { ImageRowSection, ImageRowSlide } from "@shared/schema";

interface ImageRowProps {
  data: ImageRowSection;
}

const GAP_CLASSES = {
  sm: "gap-1 md:gap-2",
  md: "gap-2 md:gap-4",
  lg: "gap-4 md:gap-6",
};

const BACKGROUND_CLASSES: Record<string, string> = {
  primary: "bg-primary text-primary-foreground",
  accent: "bg-accent text-accent-foreground",
  muted: "bg-muted text-muted-foreground",
  card: "bg-card text-card-foreground",
  background: "bg-background text-foreground",
};

interface TypewriterTextProps {
  text: string;
  startDelayMs: number;
  charDelayMs?: number;
  isActive: boolean;
  isEditMode: boolean;
  className?: string;
}

function TypewriterText({
  text,
  startDelayMs,
  charDelayMs = 30,
  isActive,
  isEditMode,
  className = "",
}: TypewriterTextProps) {
  const isHtml = hasHtmlTags(text);
  const totalChars = isHtml ? getTextLength(text) : text.length;

  const animText = isHtml ? " ".repeat(totalChars) : text;
  const enabled = !isEditMode && isActive;
  const { displayText } = useTypewriter(
    enabled ? [{ text: animText }] : [],
    charDelayMs,
    startDelayMs,
    3000,
    false,
  );
  const visibleChars = enabled ? displayText.length : animText.length;

  if (isHtml) {
    if (isEditMode || visibleChars >= totalChars) {
      return (
        <div
          className={className}
          dangerouslySetInnerHTML={{ __html: text }}
        />
      );
    }
    return (
      <div className={className} style={{ position: "relative" }}>
        <div
          style={{ visibility: "hidden" }}
          dangerouslySetInnerHTML={{ __html: text }}
        />
        <div
          style={{ position: "absolute", left: 0, top: 0, right: 0 }}
          dangerouslySetInnerHTML={{ __html: sliceHtml(text, visibleChars) }}
        />
      </div>
    );
  }

  if (isEditMode) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span className={className}>
      <span>{text.slice(0, visibleChars)}</span>
      <span style={{ opacity: 0 }}>{text.slice(visibleChars)}</span>
    </span>
  );
}

interface HighlightSlideshowProps {
  slides: ImageRowSlide[];
  autoplayInterval: number;
  showIndicators: boolean;
  isEditMode: boolean;
  isVisible: boolean;
  className?: string;
  reverseTextOrder?: boolean;
  style?: React.CSSProperties;
  firstCharDelayMs?: number;
  secondCharDelayMs?: number;
}

function HighlightSlideshow({
  slides,
  autoplayInterval,
  showIndicators,
  isEditMode,
  isVisible,
  className = "",
  reverseTextOrder,
  style = {},
  firstCharDelayMs = 30,
  secondCharDelayMs = 25,
}: HighlightSlideshowProps) {
  const [currentSlide, setCurrentSlide] = useState(0);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const clearTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const goToSlide = (index: number) => {
    if (index === currentSlide) return;
    setCurrentSlide(index);
  };

  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % slides.length);
  };

  useEffect(() => {
    clearTimer();

    if (isEditMode || slides.length <= 1 || !isVisible) {
      return;
    }

    timerRef.current = setInterval(nextSlide, autoplayInterval);

    return clearTimer;
  }, [
    isEditMode,
    slides.length,
    autoplayInterval,
    nextSlide,
    isVisible,
    clearTimer,
  ]);

  const hasMultipleSlides = slides.length > 1;

  const getContainerAnimationStyle = () => {
    if (isEditMode) return {};
    return {
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? "translateY(0)" : "translateY(24px)",
      transition: "opacity 0.5s ease-out, transform 0.5s ease-out",
    };
  };

  return (
    <div
      className={`${className} relative overflow-hidden`}
      style={{ ...style, ...getContainerAnimationStyle() }}
      data-testid="image-row-highlight"
    >
      <div className="relative flex-1 min-h-0">
        {slides.map((slide, index) => {
          const isActive = index === currentSlide;
          const slideStyle: React.CSSProperties = isEditMode
            ? { display: isActive ? "block" : "none" }
            : {
                position: index === 0 ? "relative" : "absolute",
                top: 0,
                left: 0,
                right: 0,
                opacity: isActive ? 1 : 0,
                transition: "opacity 0.5s ease-in-out",
                pointerEvents: isActive ? "auto" : "none",
              };

          const t1 = slide.text_1 || slide.heading || "";
          const t2 = slide.text_2 || slide.text || "";
          const first = reverseTextOrder ? t2 : t1;
          const second = reverseTextOrder ? t1 : t2;
          const firstLen = hasHtmlTags(first) ? getTextLength(first) : first.length;
          const firstDuration = firstLen * firstCharDelayMs;
          const secondStartDelay = 650 + firstDuration + 400;

          return (
            <div
              key={index}
              className={`flex flex-col justify-center ${reverseTextOrder ? "flex-col-reverse" : ""}`}
              style={slideStyle}
              data-testid={`slide-content-${index}`}
            >
              <div className="mb-4">
                <TypewriterText
                  text={first}
                  startDelayMs={650}
                  charDelayMs={firstCharDelayMs}
                  isActive={isActive && isVisible}
                  isEditMode={isEditMode}
                />
              </div>
              <div className="leading-tight">
                <TypewriterText
                  text={second}
                  startDelayMs={secondStartDelay}
                  charDelayMs={secondCharDelayMs}
                  isActive={isActive && isVisible}
                  isEditMode={isEditMode}
                />
              </div>
            </div>
          );
        })}
      </div>

      {hasMultipleSlides && showIndicators && (
        <div className="flex justify-center gap-2 mt-6">
          {slides.map((_, index) => (
            <button
              key={index}
              onClick={() => goToSlide(index)}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                index === currentSlide
                  ? "bg-current opacity-100 scale-125"
                  : "bg-current opacity-40"
              }`}
              aria-label={`Go to slide ${index + 1}`}
              data-testid={`slide-indicator-${index}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const PARALLAX_FACTOR = 0.08;
const PARALLAX_MAX_PX = 40;


export default function ImageRow({ data }: ImageRowProps) {
  const {
    images,
    highlight,
    height = "31rem",
    mobile_height = "24rem",
    gap = "md",
    rounded = true,
    background,
  } = data;

  const editModeContext = useEditModeOptional();
  const isEditMode = editModeContext?.isEditMode ?? false;
  const sectionRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const isInViewportRef = useRef(false);
  const imageRefsRef = useRef<(HTMLImageElement | null)[]>([]);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (isEditMode) {
      setIsVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        isInViewportRef.current = entry.isIntersecting;
        if (entry.isIntersecting && !isVisible) {
          setIsVisible(true);
        }
      },
      { threshold: 0, rootMargin: "100px 0px" },
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, [isEditMode, isVisible]);

  useEffect(() => {
    if (isEditMode) return;

    const handleScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (!isInViewportRef.current) return;
        const section = sectionRef.current;
        if (!section) return;
        const rect = section.getBoundingClientRect();
        const viewportH = window.innerHeight;
        const center = rect.top + rect.height / 2;
        const raw = (viewportH / 2 - center) * PARALLAX_FACTOR;
        const clamped = Math.max(
          -PARALLAX_MAX_PX,
          Math.min(PARALLAX_MAX_PX, raw),
        );

        imageRefsRef.current.forEach((img, i) => {
          if (!img) return;
          const dir = i % 2 === 0 ? -1 : 1;
          img.style.transform = `translateY(${dir * clamped}px) scale(1.15)`;
        });
      });
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      window.removeEventListener("scroll", handleScroll);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isEditMode]);

  const gapClass = GAP_CLASSES[gap] || GAP_CLASSES.md;
  const roundedClass = rounded ? "rounded-lg" : "";
  const highlightWidth = highlight?.width || 2;
  const highlightBg = highlight?.background
    ? BACKGROUND_CLASSES[highlight.background] || BACKGROUND_CLASSES.primary
    : BACKGROUND_CLASSES.primary;

  const sectionBgClass = background ? BACKGROUND_CLASSES[background] || "" : "";

  const getAnimationStyle = (index: number) => {
    if (isEditMode) return {};
    return {
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? "translateY(0)" : "translateY(24px)",
      transition: `opacity 0.5s ease-out ${index * 0.12}s, transform 0.5s ease-out ${index * 0.12}s`,
    };
  };

  const highlightIndex = images.length;

  const slides: ImageRowSlide[] = highlight?.slides?.length
    ? highlight.slides
    : (highlight?.text_1 && highlight?.text_2)
      ? [{ text_1: highlight.text_1, text_2: highlight.text_2 }]
      : (highlight?.heading && highlight?.text)
        ? [{ text_1: highlight.heading, text_2: highlight.text }]
        : [];

  const autoplayInterval = highlight?.autoplay_interval || 5000;
  const showIndicators = highlight?.show_indicators !== false;
  const reverseTextOrder = highlight?.reverse_text_order === true;

  return (
    <section
      ref={sectionRef}
      className={sectionBgClass}
      data-testid="section-image-row"
    >
      <div className="container mx-auto px-4">
        <div className="flex flex-col gap-4 max-w-7xl mx-auto">
          {slides.length > 0 && (
            <HighlightSlideshow
              slides={slides}
              autoplayInterval={autoplayInterval}
              showIndicators={showIndicators}
              isEditMode={isEditMode}
              isVisible={isVisible}
              className={`${highlightBg} px-6 py-8 md:px-8 md:py-12 rounded-card md:hidden`}
              reverseTextOrder={reverseTextOrder}
              firstCharDelayMs={10}
              secondCharDelayMs={5}
            />
          )}

          <div
            className={`flex flex-row items-stretch ${gapClass}`}
            style={
              {
                "--image-row-height-mobile": mobile_height,
                "--image-row-height-desktop": height,
              } as React.CSSProperties
            }
            data-testid="image-row-container"
          >
            <div className="contents" style={{ display: "contents" }}>
              {images.map((image, index) => {
                const imageHeight = image.height || undefined;
                return (
                  <div
                    key={image.src || `image-${index}`}
                    className={`flex-1 min-w-0 overflow-hidden ${roundedClass}`}
                    style={{
                      height: imageHeight || `var(--image-row-height-mobile)`,
                      ...getAnimationStyle(index),
                    }}
                    data-testid={`image-row-item-${index}`}
                  >
                    <style>{`
                      @media (min-width: 768px) {
                        [data-testid="image-row-item-${index}"] {
                          height: ${imageHeight || `var(--image-row-height-desktop)`} !important;
                        }
                      }
                    `}</style>
                    <UniversalImage
                      id={image.src}
                      alt={image.alt}
                      className="w-full h-full"
                      style={{
                        objectFit: image.object_fit || "cover",
                        objectPosition: image.object_position || "center center",
                        transform: "translateY(0px) scale(1.15)",
                        willChange: "transform",
                      }}
                      loading="lazy"
                      fieldContext={{ arrayPath: "images", index, srcField: "src" }}
                      onImgRef={(el) => { imageRefsRef.current[index] = el; }}
                    />
                  </div>
                );
              })}

              {slides.length > 0 && (
                <HighlightSlideshow
                  slides={slides}
                  autoplayInterval={autoplayInterval}
                  showIndicators={showIndicators}
                  isEditMode={isEditMode}
                  isVisible={isVisible}
                  className={`hidden md:flex ${highlightBg} px-6 py-8 md:px-8 md:py-12 rounded-card flex-col h-[var(--image-row-height-desktop)]`}
                  reverseTextOrder={reverseTextOrder}
                  firstCharDelayMs={30}
                  secondCharDelayMs={25}
                  style={{
                    flex: highlightWidth,
                    ...getAnimationStyle(highlightIndex),
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
