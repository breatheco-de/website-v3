import { useState, useEffect, useRef } from "react";
import { Star } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import UniversalImage from "@/components/UniversalImage";
import type { TestimonialsSection as TestimonialsSectionType } from "@shared/schema";
import { DotsIndicator } from "@/components/DotsIndicator";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

interface LegacyTestimonial {
  id: string;
  name: string;
  role: string;
  course?: string;
  rating: number;
  comment: string;
}

interface TestimonialsSectionProps {
  data?: TestimonialsSectionType;
  testimonials?: LegacyTestimonial[];
}

interface TestimonialItem {
  name: string;
  role: string;
  rating: number;
  comment: string;
  company?: string;
  outcome?: string;
  avatar?: string;
}

interface BankTestimonial {
  student_name: string;
  student_thumb?: string;
  student_video?: string;
  excerpt?: string;
  full_text?: string;
  content?: string;
  short_content?: string;
  related_features?: string[];
  priority?: number;
  rating?: number;
  role?: string;
  company?: string;
}

const ANONYMOUS_NAMES = ["anonymous", "anonimous", "anónimo", "anonimo", "anon"];

function isAnonymous(name: string): boolean {
  return ANONYMOUS_NAMES.includes(name.trim().toLowerCase());
}

function isValidBankTestimonial(t: BankTestimonial): boolean {
  if (isAnonymous(t.student_name)) return false;
  if (t.student_video) return false;
  const hasText = !!(t.excerpt || t.short_content || t.content || t.full_text);
  return hasText;
}

function mapBankToItem(t: BankTestimonial): TestimonialItem {
  return {
    name: t.student_name,
    role: t.role || "",
    rating: t.rating || 5,
    comment: t.excerpt || t.short_content || t.content || t.full_text || "",
    company: t.company,
    avatar: t.student_thumb,
  };
}

function sortBankTestimonials(testimonials: BankTestimonial[], relatedFeatures?: string[]): BankTestimonial[] {
  return [...testimonials].sort((a, b) => {
    const aPriority5 = (a.priority ?? 0) >= 5 ? 1 : 0;
    const bPriority5 = (b.priority ?? 0) >= 5 ? 1 : 0;
    if (bPriority5 !== aPriority5) return bPriority5 - aPriority5;

    if (relatedFeatures && relatedFeatures.length > 0) {
      const aFeatures = a.related_features || [];
      const bFeatures = b.related_features || [];
      const aMatchCount = relatedFeatures.filter((f) => aFeatures.includes(f)).length;
      const bMatchCount = relatedFeatures.filter((f) => bFeatures.includes(f)).length;
      if (bMatchCount !== aMatchCount) return bMatchCount - aMatchCount;
    }

    return (b.priority ?? 0) - (a.priority ?? 0);
  });
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Desktop values
const CARD_WIDTH_DESKTOP = 380;
const CARD_SPACING_DESKTOP = 330;
// Mobile values (smaller)
const CARD_WIDTH_MOBILE = 240;
const CARD_SPACING_MOBILE = 220;

const DRAG_MULTIPLIER = 0.52;
const SIDE_SCALE = 0.85;
const SIDE_OPACITY = 0.5;
// Mobile: side cards fade harder so half-cut text doesn't read as broken content
const SIDE_OPACITY_MOBILE = 0.2;

export function TestimonialsSection({ data, testimonials }: TestimonialsSectionProps) {
  const { i18n } = useTranslation();
  const locale = i18n.language?.startsWith("es") ? "es" : "en";

  const relatedFeatures = data?.related_features || [];
  const limit = Math.min(data?.limit || 10, 30);
  const useBankData = relatedFeatures.length > 0;

  const { data: bankData } = useQuery<{ testimonials: BankTestimonial[] }>({
    queryKey: ["/api/testimonials", locale],
    staleTime: 5 * 60 * 1000,
    enabled: useBankData,
  });

  const bankItems: TestimonialItem[] = (() => {
    if (!useBankData || !bankData?.testimonials) return [];
    const valid = bankData.testimonials.filter(isValidBankTestimonial);
    const filtered = valid.filter((t) => {
      const features = t.related_features || [];
      return relatedFeatures.some((f) => features.includes(f));
    });
    const sorted = sortBankTestimonials(filtered, relatedFeatures);
    return sorted.slice(0, limit).map(mapBankToItem);
  })();

  const hardcodedItems: TestimonialItem[] = data?.items
    ? data.items.map((item) => ({
        name: item.name,
        role: item.role,
        rating: item.rating,
        comment: item.comment,
        company: item.company,
        avatar: item.avatar,
        outcome: item.outcome,
      }))
    : testimonials?.map((t) => ({
        name: t.name,
        role: t.role,
        rating: t.rating,
        comment: t.comment,
        company: t.course,
      })) ?? [];

  const items = useBankData && bankItems.length > 0 ? bankItems : hardcodedItems;

  const title = data?.title || "What Our Students Say";
  const subtitle = data?.subtitle;
  const ratingSummary = data?.rating_summary;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [cardTransforms, setCardTransforms] = useState<Map<number, { scale: number; opacity: number; zIndex: number }>>(new Map());
  const [activeIndex, setActiveIndex] = useState(1);
  const isResettingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  
  // Desktop/Tablet detection - use custom drag and full-size cards on tablet and desktop
  const [isDesktopOrTablet, setIsDesktopOrTablet] = useState(false);
  
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    setIsDesktopOrTablet(query.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktopOrTablet(e.matches);
    query.addEventListener('change', handler);
    return () => query.removeEventListener('change', handler);
  }, []);

  // Drag state
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const scrollStartRef = useRef(0);
  
  // Responsive card dimensions - tablet uses desktop sizes
  const cardWidth = isDesktopOrTablet ? CARD_WIDTH_DESKTOP : CARD_WIDTH_MOBILE;
  const cardSpacing = isDesktopOrTablet ? CARD_SPACING_DESKTOP : CARD_SPACING_MOBILE;

  // Triple the items for infinite loop on desktop/tablet, single set on mobile
  const extendedItems = isDesktopOrTablet ? [...items, ...items, ...items] : items;
  const originalLength = items.length;

  const updateCardTransforms = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerCenter = container.clientWidth / 2;
    const scrollLeft = container.scrollLeft;
    
    // On mobile, cards are offset so first card is centered at scroll 0
    const mobileLeftOffset = isDesktopOrTablet ? 0 : (containerCenter - cardWidth / 2);

    const newTransforms = new Map<number, { scale: number; opacity: number; zIndex: number }>();
    
    // Track closest card to center
    let closestIndex = 0;
    let closestDistance = Infinity;

    // Apply transforms based on continuous distance from center
    // Smooth linear interpolation - no sudden jumps
    extendedItems.forEach((_, index) => {
      const cardCenterX = mobileLeftOffset + (index * cardSpacing) + (cardWidth / 2) - scrollLeft;
      const distanceFromCenter = Math.abs(cardCenterX - containerCenter);
      
      // Track closest card
      if (distanceFromCenter < closestDistance) {
        closestDistance = distanceFromCenter;
        closestIndex = index;
      }
      
      // Normalize distance: 0 = centered, 1 = one card away
      const normalizedDist = distanceFromCenter / cardSpacing;

      let scale: number;
      let opacity: number;
      let zIndex: number;

      // Smooth continuous interpolation based on distance
      // Center card (dist ~0): scale 1, opacity 1
      // Side cards (dist ~1): scale 0.85, opacity 0.5
      // Hidden (dist > 1.5): opacity 0
      
      const sideOpacity = isDesktopOrTablet ? SIDE_OPACITY : SIDE_OPACITY_MOBILE;

      if (normalizedDist <= 1) {
        // Smoothly interpolate from center to side
        scale = 1 - (normalizedDist * (1 - SIDE_SCALE));
        opacity = 1 - (normalizedDist * (1 - sideOpacity));
        // Z-index based on proximity - closer = higher
        zIndex = Math.round(10 - normalizedDist * 5);
      } else if (normalizedDist <= 2) {
        // Fade out zone
        const fadeProgress = normalizedDist - 1; // 0 to 1
        scale = SIDE_SCALE;
        opacity = sideOpacity * (1 - fadeProgress);
        zIndex = 1;
      } else {
        // Hidden
        scale = SIDE_SCALE;
        opacity = 0;
        zIndex = 1;
      }

      newTransforms.set(index, { scale, opacity, zIndex });
    });

    setCardTransforms(newTransforms);
    
    // Update active index (modulo to get original item index)
    setActiveIndex(closestIndex % originalLength);
  };

  const checkInfiniteLoop = () => {
    // Disable infinite loop on mobile to prevent blinking
    if (!isDesktopOrTablet) return;
    if (isResettingRef.current) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const singleSetWidth = originalLength * cardSpacing;
    const minScroll = singleSetWidth * 0.5;
    const maxScroll = singleSetWidth * 2;

    if (container.scrollLeft < minScroll) {
      isResettingRef.current = true;
      container.scrollLeft += singleSetWidth;
      requestAnimationFrame(() => {
        isResettingRef.current = false;
        updateCardTransforms();
      });
    } else if (container.scrollLeft > maxScroll) {
      isResettingRef.current = true;
      container.scrollLeft -= singleSetWidth;
      requestAnimationFrame(() => {
        isResettingRef.current = false;
        updateCardTransforms();
      });
    }
  };

  const handleScroll = () => {
    checkInfiniteLoop();

    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(updateCardTransforms);
  };

  // Smooth scroll animation to target
  const animateScrollTo = (targetScroll: number, duration: number = 300) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const startScroll = container.scrollLeft;
    const distance = targetScroll - startScroll;
    const startTime = performance.now();

    const easeInOutCubic = (t: number): number => {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    };

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeInOutCubic(progress);

      container.scrollLeft = startScroll + (distance * eased);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        checkInfiniteLoop();
        updateCardTransforms();
      }
    };

    requestAnimationFrame(animate);
  };

  // Navigate to specific card by original index
  const navigateToCard = (targetOriginalIndex: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerCenter = container.clientWidth / 2;
    // Use middle set for navigation (index in range [originalLength, originalLength*2))
    const targetExtendedIndex = originalLength + targetOriginalIndex;
    const targetScroll = (targetExtendedIndex * cardSpacing) + (cardWidth / 2) - containerCenter;
    
    animateScrollTo(targetScroll, 300);
  };

  // Snap to nearest card center
  const snapToNearestCard = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const containerCenter = container.clientWidth / 2;
    const currentScroll = container.scrollLeft;

    // Find which card center is closest to container center
    let closestIndex = 0;
    let closestDistance = Infinity;

    extendedItems.forEach((_, index) => {
      const cardCenterX = (index * cardSpacing) + (cardWidth / 2) - currentScroll;
      const distance = Math.abs(cardCenterX - containerCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    // Calculate scroll position to center that card
    const targetScroll = (closestIndex * cardSpacing) + (cardWidth / 2) - containerCenter;
    
    // Animate to target
    animateScrollTo(targetScroll, 250);
  };

  // Drag handlers
  const handleDragStart = (clientX: number) => {
    const container = scrollContainerRef.current;
    if (!container) return;

    isDraggingRef.current = true;
    dragStartXRef.current = clientX;
    scrollStartRef.current = container.scrollLeft;
    container.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';
  };

  const handleDragMove = (clientX: number) => {
    if (!isDraggingRef.current) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    const deltaX = (dragStartXRef.current - clientX) * DRAG_MULTIPLIER;
    container.scrollLeft = scrollStartRef.current + deltaX;
  };

  const handleDragEnd = () => {
    if (!isDraggingRef.current) return;
    
    const container = scrollContainerRef.current;
    if (!container) return;

    isDraggingRef.current = false;
    container.style.cursor = 'grab';
    document.body.style.userSelect = '';

    // Smooth snap to nearest card
    snapToNearestCard();
  };

  // Mouse events
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX);
  };

  const handleMouseMove = (e: MouseEvent) => {
    handleDragMove(e.clientX);
  };

  const handleMouseUp = () => {
    if (isDraggingRef.current) {
      handleDragEnd();
    }
  };

  // Touch tracking for determining horizontal vs vertical swipe
  const touchStartYRef = useRef(0);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  // Initialize scroll position
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || items.length === 0) return;

    const containerCenter = container.clientWidth / 2;
    
    if (isDesktopOrTablet) {
      // Desktop/Tablet: Start in the middle set, centered on second card (for infinite loop)
      const initialScroll = (originalLength * cardSpacing) + cardSpacing + (cardWidth / 2) - containerCenter;
      container.scrollLeft = initialScroll;
      container.style.cursor = 'grab';
    } else {
      // Mobile: Start centered on second card (no infinite loop)
      container.scrollLeft = cardSpacing;
    }

    requestAnimationFrame(updateCardTransforms);
  }, [items.length, originalLength, cardWidth, cardSpacing, isDesktopOrTablet]);

  // Native touch handlers (needed for { passive: false } to allow preventDefault)
  const nativeTouchStart = (e: TouchEvent) => {
    const touch = e.touches[0];
    touchStartYRef.current = touch.clientY;
    isHorizontalSwipeRef.current = null;
    handleDragStart(touch.clientX);
  };

  const nativeTouchMove = (e: TouchEvent) => {
    if (!isDraggingRef.current) return;
    
    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - dragStartXRef.current);
    const deltaY = Math.abs(touch.clientY - touchStartYRef.current);
    
    // Determine swipe direction on first significant move
    if (isHorizontalSwipeRef.current === null && (deltaX > 10 || deltaY > 10)) {
      isHorizontalSwipeRef.current = deltaX > deltaY;
    }
    
    // Only handle horizontal swipes, let vertical ones pass through
    if (isHorizontalSwipeRef.current) {
      e.preventDefault(); // This works because we use { passive: false }
      handleDragMove(touch.clientX);
    } else {
      // Cancel our drag if user is scrolling vertically
      isDraggingRef.current = false;
    }
  };

  const nativeTouchEnd = () => {
    isHorizontalSwipeRef.current = null;
    handleDragEnd();
  };

  // Set up listeners
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    // Force end drag on window blur (user tabs away)
    const handleWindowBlur = () => {
      if (isDraggingRef.current) {
        handleDragEnd();
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', updateCardTransforms);
    
    // Only add mouse/touch drag handlers on desktop - mobile uses native scroll
    if (isDesktopOrTablet) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('blur', handleWindowBlur);
      container.addEventListener('touchstart', nativeTouchStart, { passive: true });
      container.addEventListener('touchmove', nativeTouchMove, { passive: false });
      container.addEventListener('touchend', nativeTouchEnd, { passive: true });
    }

    return () => {
      container.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', updateCardTransforms);
      if (isDesktopOrTablet) {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('blur', handleWindowBlur);
        container.removeEventListener('touchstart', nativeTouchStart);
        container.removeEventListener('touchmove', nativeTouchMove);
        container.removeEventListener('touchend', nativeTouchEnd);
      }
      document.body.style.userSelect = '';
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [handleScroll, updateCardTransforms, handleMouseMove, handleMouseUp, handleDragEnd, nativeTouchStart, nativeTouchMove, nativeTouchEnd, isDesktopOrTablet]);

  if (items.length === 0) return null;

  const totalWidth = extendedItems.length * cardSpacing;
  
  // On mobile, offset cards so first card can be centered
  // This creates space on the left so first card center aligns with viewport center at scroll 0
  const mobileOffset = isDesktopOrTablet ? 0 : `calc(50vw - ${cardWidth / 2}px)`;

  return (
    <section 
      className="bg-background overflow-hidden"
      data-testid="section-testimonials"
    >
      <div className="max-w-6xl mx-auto px-0 md:px-4">
        <div className="text-center">
          {ratingSummary && (
            <div 
              className="flex items-center justify-center gap-2 mb-4"
              data-testid="rating-summary"
            >
              <Star className="fill-current w-7 h-7 text-yellow-500" />
              <span className="text-2xl font-bold text-foreground">
                {String(ratingSummary.average)}
              </span>
              <span className="text-muted-foreground">
                / {String(ratingSummary.count)} Reviews
              </span>
            </div>
          )}
          
          <h2 
            className="text-h2 mb-4 text-foreground"
            data-testid="text-testimonials-title"
          >
            {title}
          </h2>
          
          {subtitle && (
            <p 
              className="text-body text-muted-foreground max-w-2xl mx-auto"
              data-testid="text-testimonials-subtitle"
            >
              {subtitle}
            </p>
          )}
        </div>

        {/* Carousel Container */}
        <div className="relative h-[380px] lg:h-[420px]">
          {/* Left fade - wide enough on mobile to soften half-cut side cards */}
          <div 
            className="absolute left-0 top-0 bottom-0 w-[56px] lg:w-[180px] bg-gradient-to-r from-background to-transparent z-30 pointer-events-none"
          />
          
          {/* Right fade - wide enough on mobile to soften half-cut side cards */}
          <div 
            className="absolute right-0 top-0 bottom-0 w-[56px] lg:w-[180px] bg-gradient-to-l from-background to-transparent z-30 pointer-events-none"
          />

          {/* Scrollable container - native scroll on mobile, custom drag on desktop */}
          <div
            ref={scrollContainerRef}
            className={`h-full overflow-x-auto overflow-y-hidden scrollbar-hide ${
              isDesktopOrTablet 
                ? "select-none cursor-grab" 
                : "snap-x snap-mandatory touch-auto"
            }`}
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
            onMouseDown={isDesktopOrTablet ? handleMouseDown : undefined}
          >
            {/* Cards track - absolute positioning for overlap */}
            <div
              className="h-full relative"
              style={{ 
                width: `${totalWidth + cardWidth}px`,
              }}
            >
              {extendedItems.map((testimonial, index) => {
                const transform = cardTransforms.get(index) || { scale: SIDE_SCALE, opacity: 0, zIndex: 1 };
                const leftPosition = index * cardSpacing;
                
                return (
                  <div
                    key={index}
                    className={`absolute top-1/2 pointer-events-none ${!isDesktopOrTablet ? "snap-center" : ""}`}
                    style={{
                      width: `${cardWidth}px`,
                      left: isDesktopOrTablet ? `${leftPosition}px` : `calc(${mobileOffset} + ${leftPosition}px)`,
                      transform: `translateY(-50%) scale(${transform.scale})`,
                      opacity: transform.opacity,
                      zIndex: transform.zIndex,
                    }}
                  >
                    <TestimonialCard testimonial={testimonial} index={index} />
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Dots Indicator */}
        <div>
          <DotsIndicator
            count={originalLength}
            activeIndex={activeIndex}
            onDotClick={navigateToCard}
            ariaLabel="Testimonial navigation"
          />
        </div>
      </div>
    </section>
  );
}

export default TestimonialsSection;

interface TestimonialCardProps {
  testimonial: TestimonialItem;
  index: number;
}

function TestimonialCard({ testimonial, index }: TestimonialCardProps) {
  return (
    <Card className="min-h-[320px] md:min-h-[270px] border border-border bg-card">
      <CardContent className="p-6 h-full flex flex-col min-h-[320px] md:min-h-[270px]">
        {/* Header with Avatar and Info */}
        <div className="flex items-center gap-3 mb-4">
          <Avatar className="w-12 h-12 flex-shrink-0 overflow-hidden">
            {testimonial.avatar ? (
              <UniversalImage
                id={testimonial.avatar}
                alt={testimonial.name}
                className="w-full h-full"
                style={{ objectFit: "cover" }}
                fieldContext={{ arrayPath: "items", index, srcField: "avatar" }}
              />
            ) : (
              <AvatarFallback className="bg-muted text-muted-foreground text-base font-semibold">
                {getInitials(testimonial.name)}
              </AvatarFallback>
            )}
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-foreground truncate text-base">
              {testimonial.name}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {testimonial.role}
              {testimonial.company && ` at ${testimonial.company}`}
            </p>
          </div>
        </div>

        {/* Star Rating */}
        <div className="flex items-center gap-1 mb-3">
          {Array.from({ length: 5 }).map((_, i) =>
            i < testimonial.rating ? (
              <Star key={i} className="fill-current w-5 h-5 text-yellow-500" />
            ) : (
              <Star key={i} className="w-5 h-5 text-muted" />
            ),
          )}
        </div>

        {/* Review Text — flex-1 on wrapper only; line-clamp on inner p (flex grow breaks clamp) */}
        <div className="min-h-0 flex-1 overflow-hidden">
          <p className="text-muted-foreground leading-relaxed text-sm line-clamp-[8] md:line-clamp-5">
            {testimonial.comment}
          </p>
        </div>

        {/* Outcome Badge - always at bottom */}
        {testimonial.outcome && (
          <div className="pt-3 mt-auto">
            <Badge
              variant="secondary"
              className="text-xs max-w-full whitespace-normal break-words text-left h-auto"
            >
              {testimonial.outcome}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
