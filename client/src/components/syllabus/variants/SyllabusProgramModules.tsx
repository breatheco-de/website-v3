import { useState, useRef, useEffect } from "react";
import type { SyllabusDefault, SyllabusLanding, SyllabusProgramModules } from "@shared/schema";
import { Box, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DotsIndicator } from "@/components/DotsIndicator";
import { SyllabusModuleCard } from "@/components/syllabus/SyllabusModuleCard";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import type { ComponentType } from "react";
import { getIcon as getLucideIcon } from "@/lib/icons";
import { getTechBrandIcon } from "@/lib/tech-brand-icons";
import Matplotlib from "@/components/custom-icons/Matplotlib";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { useInternalNav } from "@/hooks/useInternalNav";
interface ModuleAccordionProps {
  title: string;
  description: string;
  isOpen: boolean;
  onToggle: () => void;
  testId: string;
  expandLabel?: string;
  collapseLabel?: string;
} 

function renderSectionIcon(iconName: string, className?: string) {
  const cls = className || "w-5 h-5 text-primary";
  const IconComponent = getLucideIcon(iconName);
  if (IconComponent) {
    return <IconComponent className={cls} />;
  }
  return <Box className={cls} />;
}

function ModuleAccordion({ title, description, isOpen, onToggle, testId, expandLabel, collapseLabel }: ModuleAccordionProps) {
  return (
    <div 
      className="bg-background rounded-md overflow-hidden"
      data-testid={testId}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/50 transition-colors"
        data-testid={`${testId}-toggle`}
      >
        <span className={cn(
          "font-semibold text-left",
          isOpen ? "text-primary" : "text-foreground"
        )}>
          {title}
        </span>
        <span className="text-sm text-primary flex items-center gap-1">
          <span className="hidden md:inline">{isOpen ? (collapseLabel || "Hide course details") : (expandLabel || "Course details")}</span>
          <ChevronDown 
            className={cn(
              "h-5 w-5 shrink-0 transition-transform duration-brand ease-brand",
              isOpen && "rotate-180"
            )}
          />
        </span>
      </button>
      <div
        className={cn(
          "overflow-hidden transition-all duration-brand ease-brand",
          isOpen ? "max-h-96" : "max-h-0"
        )}
      >
        <p className="px-6 pb-4 text-muted-foreground">
          {description}
        </p>
      </div>
    </div>
  );
}

interface FocusAreaCardProps {
  title: string;
  icon?: string;
  testId: string;
}

function FocusAreaCard({ title, icon, testId }: FocusAreaCardProps) {
  return (
    <Card
      className={cn(
        "transition-all duration-brand ease-brand overflow-hidden group",
        "border-l-4 border-l-primary/40",
        "bg-card hover:bg-muted hover:border-l-primary hover:shadow-card"
      )}
      data-testid={testId}
    >
      <div className="flex items-center gap-4 p-5">
        <div className={cn(
          "flex-shrink-0 transition-colors duration-brand ease-brand",
          "text-muted-foreground group-hover:text-primary"
        )}>
          {renderSectionIcon(icon || "Sparkles", "w-6 h-6")}
        </div>
        <span className="transition-colors duration-brand ease-brand text-muted-foreground font-medium group-hover:text-foreground text-body">
          {title}
        </span>
      </div>
    </Card>
  );
}

export function SyllabusDefaultAccordion({ data }: { data: SyllabusDefault }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const modules = data.modules || [];

  const handleToggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  if (modules.length === 0) {
    return (
      <section className="bg-primary/5" data-testid="section-syllabus">
        <div className="max-w-6xl mx-auto px-4 text-center text-muted-foreground">
          Syllabus section requires at least one module
        </div>
      </section>
    );
  }

  return (
    <section 
      data-testid="section-syllabus"
    >
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-8">
          <h2 
            className="text-h2 mb-4 text-foreground"
            data-testid="text-syllabus-title"
          >
            {data.title}
          </h2>
          {data.subtitle && (
            <p 
              className="text-body text-muted-foreground"
              data-testid="text-syllabus-subtitle"
            >
              {data.subtitle}
            </p>
          )}
        </div>

        <div className="space-y-2">
          {modules.map((module, index) => (
            <ModuleAccordion
              key={index}
              title={module.title}
              description={module.description}
              isOpen={openIndex === index}
              onToggle={() => handleToggle(index)}
              testId={`syllabus-module-${index}`}
              expandLabel={data.expand_label}
              collapseLabel={data.collapse_label}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

export function SyllabusLandingContent({ data }: { data: SyllabusLanding }) {
  const focusAreas = data.focus_areas || [];

  if (focusAreas.length === 0) {
    return (
      <section className="bg-primary/5" data-testid="section-syllabus-landing">
        <div className="max-w-6xl mx-auto px-4 text-center text-muted-foreground">
          Syllabus section requires at least one focus area
        </div>
      </section>
    );
  }

  return (
    <section 
      className="bg-primary/5"
      data-testid="section-syllabus-landing"
    >
      <div className="max-w-6xl mx-auto px-4">
        <div className="mb-10">
          <h2 
            className="text-h2 mb-4 text-foreground"
            data-testid="text-syllabus-title"
          >
            {data.title}
          </h2>
          {data.description && (
            <p 
              className="text-body text-muted-foreground mb-3"
              data-testid="text-syllabus-description"
            >
              {data.description}
            </p>
          )}
          {data.emphasis && (
            <p 
              className="font-semibold text-foreground text-h2"
              data-testid="text-syllabus-emphasis"
            >
              {data.emphasis}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {focusAreas.map((area, index) => (
            <FocusAreaCard
              key={index}
              title={area.title}
              icon={area.icon}
              testId={`syllabus-focus-${index}`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function getTechIcon(iconName: string, className?: string) {
  const lowerName = iconName.toLowerCase();
  const cls = className || "w-6 h-6";

  if (lowerName === "matplotlib") {
    return <Matplotlib className={cls} />;
  }

  const IconComponent = getTechBrandIcon(iconName);
  if (IconComponent && IconComponent !== Matplotlib) {
    const Comp = IconComponent as ComponentType<{ className?: string }>;
    return <Comp className={cls} />;
  }
  return null;
}

function SyllabusProgramModulesVariant({ data }: { data: SyllabusProgramModules }) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const moduleCards = data.module_cards || [];
  const [activeIndex, setActiveIndex] = useState(0);
  const prevActiveIndex = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const dragState = useRef({ startX: 0, scrollLeft: 0, lastX: 0, lastTime: 0, velocity: 0 });
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    setIsDesktop(mediaQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    if (prevActiveIndex.current !== activeIndex) {
      prevActiveIndex.current = activeIndex;
      const card = cardRefs.current[activeIndex];
      if (card) {
        card.classList.remove('animate-heartbeat');
        void card.offsetWidth;
        card.classList.add('animate-heartbeat');
      }
    }
  }, [activeIndex]);

  const [isTablet, setIsTablet] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
  useEffect(() => {
    const tabletQuery = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
    setIsTablet(tabletQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsTablet(e.matches);
    tabletQuery.addEventListener('change', handler);
    return () => tabletQuery.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)');
    setIsMobile(mobileQuery.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mobileQuery.addEventListener('change', handler);
    return () => mobileQuery.removeEventListener('change', handler);
  }, []);

  const getCardScrollPositions = () => {
    // Calculate cumulative scroll positions for each card based on actual widths
    const positions: number[] = [0];
    const gap = isDesktop ? 24 : isTablet ? 16 : 12;
    
    for (let i = 0; i < moduleCards.length; i++) {
      const isHorizontal = moduleCards[i].orientation === 'horizontal';
      const cardWidth = isHorizontal 
        ? (isDesktop ? 600 : isTablet ? 500 : 400)
        : (isDesktop ? 320 : isTablet ? 280 : 256);
      positions.push(positions[i] + cardWidth + gap);
    }
    return positions;
  };

  const updateActiveIndex = () => {
    if (!scrollContainerRef.current) return;
    const container = scrollContainerRef.current;
    const scrollPos = container.scrollLeft;
    
    // Use actual card DOM positions
    let closestIndex = 0;
    let minDistance = Infinity;
    
    for (let i = 0; i < cardRefs.current.length; i++) {
      const card = cardRefs.current[i];
      if (card) {
        // Get the card's left offset relative to the scroll container
        const cardLeft = card.offsetLeft - container.offsetLeft;
        const distance = Math.abs(scrollPos - cardLeft);
        if (distance < minDistance) {
          minDistance = distance;
          closestIndex = i;
        }
      }
    }
    
    setActiveIndex(closestIndex);
  };

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    
    const handleScroll = () => updateActiveIndex();
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  const startMomentum = (velocity: number) => {
    if (!scrollContainerRef.current || Math.abs(velocity) < 0.5) return;
    
    const friction = 0.95;
    let currentVelocity = velocity;
    
    const animate = () => {
      if (!scrollContainerRef.current || Math.abs(currentVelocity) < 0.5) {
        animationRef.current = null;
        return;
      }
      
      scrollContainerRef.current.scrollLeft -= currentVelocity;
      currentVelocity *= friction;
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animationRef.current = requestAnimationFrame(animate);
  };

  const handleDotClick = (index: number) => {
    if (!scrollContainerRef.current) return;
    if (index < 0 || index >= moduleCards.length) return;
    
    const card = cardRefs.current[index];
    if (card) {
      const container = scrollContainerRef.current;
      const cardLeft = card.offsetLeft - container.offsetLeft;
      
      container.scrollTo({
        left: cardLeft,
        behavior: isDesktop ? 'smooth' : 'instant'
      });
    }
    
    setActiveIndex(index);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (!scrollContainerRef.current) return;
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    
    setIsDragging(true);
    dragState.current = {
      startX: e.clientX,
      scrollLeft: scrollContainerRef.current.scrollLeft,
      lastX: e.clientX,
      lastTime: Date.now(),
      velocity: 0
    };
    scrollContainerRef.current.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging || !scrollContainerRef.current) return;
    e.preventDefault();
    
    const now = Date.now();
    const deltaX = e.clientX - dragState.current.lastX;
    const deltaTime = now - dragState.current.lastTime;
    
    if (deltaTime > 0) {
      dragState.current.velocity = deltaX / deltaTime * 16;
    }
    
    dragState.current.lastX = e.clientX;
    dragState.current.lastTime = now;
    
    const totalDelta = e.clientX - dragState.current.startX;
    scrollContainerRef.current.scrollLeft = dragState.current.scrollLeft - totalDelta;
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!scrollContainerRef.current) return;
    setIsDragging(false);
    scrollContainerRef.current.releasePointerCapture(e.pointerId);
    startMomentum(dragState.current.velocity);
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!scrollContainerRef.current) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      scrollContainerRef.current.scrollBy({
        left: e.deltaY,
        behavior: 'smooth'
      });
    }
  };

  if (moduleCards.length === 0) {
    return (
      <section className="bg-muted/30" data-testid="section-syllabus-program">
        <div className="max-w-6xl mx-auto px-4 text-center text-muted-foreground">
          Syllabus section requires at least one module
        </div>
      </section>
    );
  }

  return (
    <section 
      className=""
      data-testid="section-syllabus-program"
    >
      <div className="px-0 lg:pl-[max(1rem,calc((100vw-72rem)/2+1rem))] lg:pr-0">
        <div className="flex flex-col lg:flex-row">
          {/* Left: Program Info Card */}
          <div className="flex-shrink-0 lg:w-80 self-stretch px-4 lg:px-0">
            <Card className="h-full p-6 lg:p-8 bg-primary/5 shadow-card border-0 lg:border-l-4 lg:border-l-primary lg:rounded-r-none">
              <div className="mb-8 ">
                <h2 
                  className="text-h2 text-foreground mb-3"
                  data-testid="text-syllabus-program-title"
                >
                  {data.program_title}
                </h2>
                {data.program_description && (
                  <p className="text-muted-foreground mb-4" data-testid="text-syllabus-program-description">
                    {data.program_description}
                  </p>
                )}
              </div>
              
              {data.tech_logos && data.tech_logos.length > 0 && (
                <TooltipProvider delayDuration={200} skipDelayDuration={0}>
                  <div className="flex flex-wrap gap-4" data-testid="list-tech-logos">
                    {data.tech_logos.map((logo, index) => (
                      <Tooltip key={index}>
                        <TooltipTrigger asChild>
                          <div 
                            className="group text-muted-foreground hover:text-primary transition-colors duration-brand cursor-pointer"
                            data-testid={`icon-tech-${index}`}
                          >
                            {getTechIcon(logo.icon, "w-8 h-8")}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{logo.name}</p>
                        </TooltipContent>
                      </Tooltip>
                    ))}
                  </div>
                </TooltipProvider>
              )}
            </Card>
          </div>

          {/* Right: Scrollable Module Cards */}
          <div className="flex-1 min-w-0">
            <div className="relative bg-muted ps-4 lg:ps-8 py-4">
              {/* Progress Dots */}
              <div className="mb-4 lg:mb-8 pt-2">
                <DotsIndicator
                  count={moduleCards.length}
                  activeIndex={activeIndex}
                  onDotClick={handleDotClick}
                  className="justify-start ms-4 lg:ms-8"
                  ariaLabel="Module progress indicators"
                  dotSize="w-2 h-2 lg:w-3 lg:h-3"
                  activeDotWidth="w-8 lg:w-12"
                  gap="gap-2 lg:gap-4"
                />
              </div>

              {/* Module Cards Container - Drag with momentum on desktop, native scroll on mobile */}
              <div 
                ref={scrollContainerRef}
                className={cn(
                  "flex gap-3 md:gap-4 lg:gap-6 overflow-x-auto snap-x snap-mandatory",
                  isDesktop ? "select-none pb-4" : "touch-auto",
                  isDesktop && (isDragging ? "cursor-grabbing" : "cursor-grab")
                )}
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
                onPointerDown={isDesktop ? handlePointerDown : undefined}
                onPointerMove={isDesktop ? handlePointerMove : undefined}
                onPointerUp={isDesktop ? handlePointerUp : undefined}
                onPointerLeave={isDesktop ? handlePointerUp : undefined}
                onWheel={isDesktop ? handleWheel : undefined}
                data-testid="container-module-cards"
              >
                {moduleCards.map((module, index) => (
                  <div 
                    key={index}
                    className="flex-shrink-0 snap-start"
                  >
                    <div
                      ref={(el: HTMLDivElement | null) => { cardRefs.current[index] = el; }}
                      className="m-2"
                    >
                      <SyllabusModuleCard
                        duration={module.duration}
                        title={module.title}
                        objectives={module.objectives}
                        projects={module.projects ?? undefined}
                        isActive={index === activeIndex}
                        orientation={isMobile ? "vertical" : (module.orientation ?? "vertical")}
                        icon={module.icon}
                        testId={`card-module-${index}`}
                        hideExpandButton={index === 0}
                      />
                    </div>
                  </div>
                ))}
                {/* Trailing spacer to allow scrolling last card to left edge */}
                <div className="flex-shrink-0 w-[calc(100vw-80px)] md:w-[calc(100vw-100px)] lg:w-[calc(100vw-400px)]" aria-hidden="true" />
              </div>

              {/* Navigation Arrow Buttons - centered on mobile/tablet, under active card on desktop */}
              <div className="mt-2 lg:mt-4 w-full lg:ml-2 lg:w-[320px]" data-testid="container-nav-arrows">
                <div className="flex justify-center gap-3">
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-12 w-12 p-0"
                    onClick={() => handleDotClick(activeIndex - 1)}
                    disabled={activeIndex === 0}
                    aria-label="Previous milestone"
                    data-testid="button-prev-milestone"
                  >
                    <ChevronLeft className="w-6 h-6 text-primary" />
                  </Button>
                  <Button
                    variant="outline"
                    size="lg"
                    className="h-12 w-12 p-0"
                    onClick={() => handleDotClick(activeIndex + 1)}
                    disabled={activeIndex === moduleCards.length - 1}
                    aria-label="Next milestone"
                    data-testid="button-next-milestone"
                  >
                    <ChevronRight className="w-6 h-6 text-primary" />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function SyllabusProgramModules({ data }: { data: SyllabusProgramModules }) {
  const handleLinkClick = useInternalNav();
  const hasHeader =
    data.header ||
    data.subheader ||
    data.description ||
    data.cta_button;

  return (
    <section data-testid="section-syllabus-program-modules">
      {hasHeader && (
        <div className="max-w-6xl mx-auto px-4 pt-12 pb-6 text-center">
          {data.header && (
            <h2
              className="text-3xl md:text-4xl font-bold mb-3 text-foreground"
              data-testid="text-syllabus-pm-header"
            >
              {data.header}
            </h2>
          )}
          {data.subheader && (
            <p
              className="text-lg font-semibold text-primary mb-3"
              data-testid="text-syllabus-pm-subheader"
            >
              {data.subheader}
            </p>
          )}
          {data.description && (
            <div className="mb-5">
              <RichTextContent
                html={data.description}
                className="text-base text-muted-foreground leading-relaxed max-w-3xl mx-auto"
                data-testid="text-syllabus-pm-description"
              />
            </div>
          )}
          {data.cta_button && (
            <div className="flex justify-center">
              <Button
                variant={
                  data.cta_button.variant === "primary"
                    ? "default"
                    : data.cta_button.variant
                }
                size="lg"
                asChild
                data-testid="button-syllabus-pm-cta"
              >
                <a href={data.cta_button.url} onClick={handleLinkClick} className="flex items-center gap-2">
                  {data.cta_button.icon && renderSectionIcon(data.cta_button.icon, "w-5 h-5")}
                  {data.cta_button.text}
                </a>
              </Button>
            </div>
          )}
        </div>
      )}
      <SyllabusProgramModulesVariant data={data} />
    </section>
  );
}
