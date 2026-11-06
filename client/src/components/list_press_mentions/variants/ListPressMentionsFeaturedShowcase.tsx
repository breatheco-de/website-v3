
import { useState, useEffect, useRef } from "react";
import { Star, ChevronLeft, ChevronRight, ChevronDown, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ListPressMentionsSection } from "@shared/schema";
import { UniversalImage } from "@/components/UniversalImage";
import { DotsIndicator } from "@/components/DotsIndicator";
import { coerceToHtml, coerceToText } from "@/lib/variable-manager";
import { sectionBackgroundStyle } from "@shared/theme-palette";

type PressMentionItem = NonNullable<ListPressMentionsSection["items"]>[number];

function normalizeBadges(badges: unknown): string[] {
  if (!Array.isArray(badges)) return [];
  const result: string[] = [];
  for (const badge of badges) {
    if (typeof badge === "string" || typeof badge === "number") {
      const text = coerceToText(badge);
      if (text) result.push(text);
      continue;
    }
    if (badge && typeof badge === "object") {
      const obj = badge as Record<string, unknown>;
      const text = coerceToText(obj.text ?? obj.label ?? obj.name ?? badge);
      if (text) result.push(text);
    }
  }
  return result;
}

interface ListPressMentionsFeaturedShowcaseProps {
  data: ListPressMentionsSection;
}

function useCardsPerPage(): number {
  const getCardsPerPage = () => {
    if (typeof window === "undefined") return 3;
    if (window.innerWidth < 640) return 1;
    if (window.innerWidth < 1024) return 2;
    return 3;
  };

  const [cardsPerPage, setCardsPerPage] = useState(getCardsPerPage);

  useEffect(() => {
    const handleResize = () => setCardsPerPage(getCardsPerPage());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return cardsPerPage;
}

export default function ListPressMentionsFeaturedShowcase({ data }: ListPressMentionsFeaturedShowcaseProps) {
  const items = data.items || [];
  const titleHtml = coerceToHtml(data.title);
  const showLinks = data.show_links ?? false;
  const showLogos = data.show_logos ?? true;
  const footerStats = data.footer_stats || [];
  const footerText = data.footer_text;
  const badgeColor = data.badge_color;
  const badgeTextColor = data.badge_text_color;

  const featured = items[0];
  const featuredBadges = normalizeBadges(featured?.badges);
  const allCards = items.slice(1);

  const cardsPerPage = useCardsPerPage();

  const pageGroups: PressMentionItem[][] = [];
  for (let i = 0; i < allCards.length; i += cardsPerPage) {
    pageGroups.push(allCards.slice(i, i + cardsPerPage));
  }
  const totalPages = pageGroups.length;

  const [currentPage, setCurrentPage] = useState(0);
  const [isExpandedMobile, setIsExpandedMobile] = useState(false);
  const mobileViewportRef = useRef<HTMLDivElement | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const swipeDeltaXRef = useRef(0);
  const isHorizontalSwipeRef = useRef(false);

  useEffect(() => {
    if (totalPages > 0 && currentPage >= totalPages) {
      setCurrentPage(totalPages - 1);
    }
  }, [totalPages, currentPage]);

  useEffect(() => {
    setCurrentPage(0);
  }, [cardsPerPage]);

  const resetTouchState = () => {
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    swipeDeltaXRef.current = 0;
    isHorizontalSwipeRef.current = false;
  };

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (cardsPerPage !== 1) return;
    const touch = event.touches[0];
    if (!touch) return;

    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    swipeDeltaXRef.current = 0;
    isHorizontalSwipeRef.current = false;
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (cardsPerPage !== 1) return;
    const touch = event.touches[0];
    if (!touch || touchStartXRef.current === null || touchStartYRef.current === null) return;

    const deltaX = touch.clientX - touchStartXRef.current;
    const deltaY = touch.clientY - touchStartYRef.current;

    if (!isHorizontalSwipeRef.current) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
      isHorizontalSwipeRef.current = true;
    }

    event.preventDefault();
    swipeDeltaXRef.current = deltaX;
  };

  const handleTouchEnd = () => {
    if (cardsPerPage !== 1) {
      resetTouchState();
      return;
    }
    if (!isHorizontalSwipeRef.current) {
      resetTouchState();
      return;
    }

    const viewportWidth = mobileViewportRef.current?.offsetWidth ?? 0;
    const swipeThreshold = Math.max(viewportWidth * 0.18, 48);
    const finalOffset = swipeDeltaXRef.current;

    if (finalOffset <= -swipeThreshold && currentPage < totalPages - 1) {
      setCurrentPage((prev) => prev + 1);
    } else if (finalOffset >= swipeThreshold && currentPage > 0) {
      setCurrentPage((prev) => prev - 1);
    }

    resetTouchState();
  };

  const bgStyle: React.CSSProperties = sectionBackgroundStyle(data.background);

  return (
    <section
      style={bgStyle}
      data-testid="section-press-mentions-showcase"
    >
      <div className="max-w-6xl mx-auto px-4 flex flex-col gap-8">

        {/* Header */}
        {(titleHtml || data.subtitle) && (
          <div className="text-center flex flex-col gap-3">
            {titleHtml && (
              <h2
                className="text-3xl md:text-4xl font-bold text-foreground leading-tight whitespace-pre-line [&_p]:mb-0 [&_p]:inline [&_p]:m-0"
                style={data.title_color ? { color: data.title_color } : undefined}
                data-testid="text-press-showcase-title"
                dangerouslySetInnerHTML={{ __html: titleHtml }}
              />
            )}
            {data.subtitle && (
              <p
                className="text-base text-muted-foreground max-w-2xl mx-auto"
                style={data.subtitle_color ? { color: data.subtitle_color } : undefined}
                data-testid="text-press-showcase-subtitle"
              >
                {data.subtitle}
              </p>
            )}
          </div>
        )}

        {/* Featured Card */}
        {featured && (
          <div
            className="bg-primary rounded-[0.8rem] p-6 md:p-8 flex flex-col md:flex-row gap-3 md:gap-4 md:items-center"
            data-testid="card-press-featured"
          >
            <div className="flex items-start justify-between gap-3 md:hidden">
              <div className="flex-shrink-0 flex flex-row items-center justify-between gap-2">
                <div
                  className="p-3 rounded-full"
                  style={{ backgroundColor: "hsl(var(--accent) / 0.4)" }}
                >
                  <Star className="w-6 h-6" style={{ color: "hsl(var(--accent))" }} fill="currentColor" />
                </div>
                {featured.year && (
                  <span className="text-sm font-bold text-white" data-testid="text-press-featured-year">
                    {featured.year}
                  </span>
                )}
              </div>

              {featured.tags && featured.tags.length > 0 && (
                <div className="flex flex-wrap justify-center content-center gap-2 max-w-[60%]">
                  {featured.tags.slice(0, 4).map((tag, i) => (
                    <span
                      key={i}
                      className="bg-background text-center text-foreground text-[11px] px-2.5 py-0.5 rounded-full font-medium leading-tight"
                      data-testid={`tag-press-featured-mobile-${i}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Star + year — row on mobile, column on md+ */}
            <div className="hidden md:flex flex-shrink-0 md:flex-col items-center gap-2 md:w-16">
              <div
                className="p-3 rounded-full"
                style={{ backgroundColor: "hsl(var(--accent) / 0.4)" }}
              >
                <Star className="w-6 h-6" style={{ color: "hsl(var(--accent))" }} fill="currentColor" />
              </div>
              {featured.year && (
                <span className="text-sm font-bold text-white" data-testid="text-press-featured-year">
                  {featured.year}
                </span>
              )}
            </div>

            {/* Center: org label + title */}
            <div className="flex-1 min-w-0 lg:min-w-[650px] xl:min-w-[720px]">
              {featured.organization && (
                <p
                  className="text-xs font-medium uppercase tracking-wide text-white/70 mb-1.5"
                  data-testid="text-press-featured-org"
                >
                  {featured.organization}
                </p>
              )}
              {featured.title && (
                <h3
                  className="text-xl font-extrabold text-white leading-snug  max-w-[720px]"
                  data-testid="text-press-featured-title"
                >
                  {featured.title}
                </h3>
              )}
              {featuredBadges.length > 0 && (
                <div
                  className="flex flex-wrap gap-2 mt-2"
                  data-testid="badges-press-featured"
                >
                  {featuredBadges.map((badge, badgeIndex) => (
                    <Badge
                      key={`${badge}-${badgeIndex}`}
                      variant="secondary"
                      className="text-xs font-medium border-transparent rounded-full bg-background text-foreground"
                      style={{
                        ...(badgeColor ? { backgroundColor: badgeColor } : {}),
                        ...(badgeTextColor ? { color: badgeTextColor } : {}),
                      }}
                      data-testid={`badge-press-featured-${badgeIndex}`}
                    >
                      {badge}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Right: logo + link + tags */}
            <div className="flex flex-col items-start md:items-center justify-center md:shrink-0 gap-1 flex-1">
              {showLogos && featured.logo && (
                <div className="h-9" data-testid="img-press-featured-logo">
                  <UniversalImage
                    id={featured.logo}
                    alt={featured.organization || featured.title || ""}
                    className="h-full w-auto object-contain"
                    fieldContext={{ arrayPath: "items", index: 0, srcField: "logo" }}
                  />
                </div>
              )}
              {showLinks && featured.link_url && featured.link_text && (
                <a
                  href={featured.link_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm font-medium text-white/90 hover:underline"
                  data-testid="link-press-featured"
                >
                  {featured.link_text}
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              )}
              {featured.tags && featured.tags.length > 0 && (
                <div className={`hidden md:grid grid-cols-2 w-full ${featured.logo ? "gap-2" : "gap-6"}`}>
                  {featured.tags.slice(0, 4).map((tag, i) => (
                    <span
                      key={i}
                      className="bg-background text-center text-foreground text-xs px-3 py-0.5 rounded-full font-medium whitespace-nowrap m"
                      data-testid={`tag-press-featured-${i}`}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Carousel */}
        {allCards.length > 0 && (
          <div className="flex flex-col gap-3">
            <div
              ref={mobileViewportRef}
              className="overflow-hidden"
              style={cardsPerPage === 1 ? { touchAction: "pan-y" } : undefined}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleTouchEnd}
              onTouchCancel={handleTouchEnd}
            >
              <div
                className="flex items-start transition-transform duration-500 ease-in-out"
                style={{ transform: `translateX(-${currentPage * 100}%)` }}
              >
                {pageGroups.map((group, pageIdx) => (
                  <div key={pageIdx} className="flex gap-4 w-full flex-shrink-0">
                    {group.map((card, i) => {
                      const globalIndex = pageIdx * cardsPerPage + i + 1;
                      return (
                        <ShowcaseCard
                          key={globalIndex}
                          item={card}
                          index={globalIndex}
                          showLinks={showLinks}
                          showLogos={showLogos}
                          badgeColor={badgeColor}
                          badgeTextColor={badgeTextColor}
                          isExpandedMobile={isExpandedMobile}
                          onToggleMobile={() => setIsExpandedMobile((prev) => !prev)}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Nav dots — hidden when only 1 page */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  className="h-9 w-9 flex items-center justify-center rounded-full hover:bg-muted text-foreground"
                  onClick={() => setCurrentPage((p) => (p - 1 + totalPages) % totalPages)}
                  data-testid="button-press-carousel-prev"
                  aria-label="Previous"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                </button>
                <DotsIndicator
                  count={totalPages}
                  activeIndex={currentPage}
                  onDotClick={setCurrentPage}
                />
                <button
                  type="button"
                  className="h-9 w-9 flex items-center justify-center rounded-full text-foreground"
                  onClick={() => setCurrentPage((p) => (p + 1) % totalPages)}
                  data-testid="button-press-carousel-next"
                  aria-label="Next"
                >
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Footer stats */}
        {(footerStats.length > 0 || footerText) && (
          <div
            className="flex flex-col sm:flex-row items-center gap-6 items-start sm:items-center pt-2"
            data-testid="section-press-footer"
          >
            {footerStats.length > 0 && (
              <div className="flex gap-8 flex-1">
                {footerStats.map((stat, i) => (
                  <div key={i} className="flex flex-col gap-0.5" data-testid={`stat-press-footer-${i}`}>
                    {stat.value && (
                      <span className="text-3xl font-bold text-primary">
                        {stat.value}
                      </span>
                    )}
                    {stat.label && (
                      <span className="text-sm text-muted-foreground leading-snug max-w-[120px]">
                        {stat.label}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {footerText && (
              <p className="text-sm text-muted-foreground max-w-xs sm:text-right leading-relaxed">
                {footerText}
              </p>
            )}
          </div>
        )}

      </div>
    </section>
  );
}

interface ShowcaseCardProps {
  item: PressMentionItem;
  index: number;
  showLinks: boolean;
  showLogos: boolean;
  badgeColor?: string;
  badgeTextColor?: string;
  isExpandedMobile: boolean;
  onToggleMobile: () => void;
}

function ShowcaseCard({
  item,
  index,
  showLinks,
  showLogos,
  badgeColor,
  badgeTextColor,
  isExpandedMobile,
  onToggleMobile,
}: ShowcaseCardProps) {
  const badges = normalizeBadges(item.badges);
  const hasExpandableContent = !!(
    item.excerpt ||
    item.stat_value ||
    item.stat_label ||
    (item.tags && item.tags.length > 0) ||
    badges.length > 0 ||
    (showLinks && item.link_url && item.link_text)
  );

  const handleCardClick = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768 && hasExpandableContent) {
      onToggleMobile();
    }
  };

  return (
    <div
      className={`flex-1 bg-card border border-border rounded-[0.8rem] p-4 md:p-5 flex flex-col gap-2 ${hasExpandableContent ? "cursor-pointer md:cursor-default" : ""}`}
      onClick={handleCardClick}
      data-testid={`card-press-showcase-${index}`}
    >
      {/* Header: category badge + logo */}
      <div className="flex items-center gap-2">
        {item.organization && (
          <span
            className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            data-testid={`text-press-card-org-${index}`}
          >
            {item.organization}
          </span>
        )}
        {item.category && (
          <Badge className="w-fit text-xs rounded-full bg-primary/20 text-foreground border-transparent">
            {item.category}
          </Badge>
        )}
        {showLogos && item.logo && (
          <div className="w-24 h-12 shrink-0 flex items-center justify-end" data-testid={`img-press-card-logo-${index}`}>
            <UniversalImage
              id={item.logo}
              alt={item.organization || item.title || ""}
              className="max-w-full h-full object-contain rounded-md bg-white p-1"
              fieldContext={{ arrayPath: "items", index, srcField: "logo" }}
            />
          </div>
        )}
      </div>

      {/* Org (context label) + title (headline) — separate lines */}
      <div className="flex flex-col gap-0.5">
        {item.title && (
          <span
            className="text-lg font-bold text-foreground leading-snug"
            data-testid={`text-press-card-title-${index}`}
          >
            {item.title}
          </span>
        )}
        {badges.length > 0 && (
          <div
            className="flex flex-wrap gap-2 mt-1"
            data-testid={`badges-press-card-${index}`}
          >
            {badges.map((badge, badgeIndex) => (
              <Badge
                key={`${badge}-${badgeIndex}`}
                variant="secondary"
                className="text-xs font-medium border-transparent rounded-full"
                style={{
                  ...(badgeColor ? { backgroundColor: badgeColor } : {}),
                  ...(badgeTextColor ? { color: badgeTextColor } : {}),
                }}
                data-testid={`badge-press-card-${index}-${badgeIndex}`}
              >
                {badge}
              </Badge>
            ))}
          </div>
        )}
        {item.title && hasExpandableContent && (
          <button
            type="button"
            className="md:hidden mt-1 inline-flex items-center gap-1 self-start text-base font-medium text-primary"
            onClick={(event) => {
              event.stopPropagation();
              onToggleMobile();
            }}
            data-testid={`button-press-card-toggle-${index}`}
          >
            {isExpandedMobile ? "See less" : "See more"}
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-300 ${isExpandedMobile ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>

      {/* Excerpt */}
      {item.excerpt && (
        <p className="hidden md:block text-sm text-muted-foreground leading-relaxed flex-1 mb-2">
          {item.excerpt}
        </p>
      )}
      <div
        className={`md:hidden overflow-hidden transition-all duration-300 ease-in-out ${
          isExpandedMobile ? "max-h-96 opacity-100 mt-2" : "max-h-0 opacity-0"
        }`}
      >
        <div className="flex flex-col gap-2 pb-1">
          {item.excerpt && (
            <p className="text-sm text-muted-foreground leading-relaxed mb-1">
              {item.excerpt}
            </p>
          )}

          {(item.stat_value || item.stat_label) && (
            <Badge
              className="max-w-full bg-primary/10 text-foreground rounded-2xl hover:bg-primary/10 text-[11px] font-semibold px-3 py-1 w-fit whitespace-normal break-words"
              data-testid={`badge-press-stat-${index}`}
              style={{ backgroundColor: "hsl(var(--accent) / 0.7)" }}
            >
              <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 text-center leading-tight">
                {item.stat_value && <span data-testid={`text-press-stat-value-${index}`}>{item.stat_value}</span>}
                {item.stat_value && item.stat_label && <span className="font-normal opacity-70">·</span>}
                {item.stat_label && <span className="font-normal opacity-80">{item.stat_label}</span>}
              </span>
            </Badge>
          )}
          {item.tags && item.tags.length > 0 && (
            <p className="text-xs text-muted-foreground" data-testid={`tags-press-card-${index}`}>
              {item.tags.slice(0, 3).map((tag, t) => (
                <span key={t}>
                  {t > 0 && <span className="mx-1 text-primary">·</span>}
                  <span data-testid={`tag-press-card-${index}-${t}`}>{tag}</span>
                </span>
              ))}
            </p>
          )}
          {showLinks && item.link_url && item.link_text && (
            <a
              href={item.link_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-sm font-medium text-primary mt-1 hover:underline"
              onClick={(event) => event.stopPropagation()}
              data-testid={`link-press-card-${index}`}
            >
              {item.link_text}
              <ArrowRight className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Bottom stats + tags + link */}
      <div className="mt-auto hidden md:flex md:flex-col md:gap-2">
        {(item.stat_value || item.stat_label) && (
          <Badge
            className="max-w-full bg-primary/10 text-foreground rounded-2xl hover:bg-primary/10 text-sm font-semibold px-3 py-1 w-fit whitespace-normal break-words"
            data-testid={`badge-press-stat-${index}`}
            style={{ backgroundColor: "hsl(var(--accent) / 0.7)" }}
          >
            <span className="inline-flex max-w-full flex-wrap items-center gap-x-1 gap-y-0.5 text-left leading-tight">
              {item.stat_value && <span data-testid={`text-press-stat-value-${index}`}>{item.stat_value}</span>}
              {item.stat_value && item.stat_label && <span className="font-normal opacity-70">·</span>}
              {item.stat_label && <span className="font-normal opacity-80">{item.stat_label}</span>}
            </span>
          </Badge>
        )}
        {item.tags && item.tags.length > 0 && (
          <p className="text-xs text-muted-foreground" data-testid={`tags-press-card-${index}`}>
            {item.tags.slice(0, 3).map((tag, t) => (
              <span key={t}>
                {t > 0 && <span className="mx-1 text-primary">·</span>}
                <span data-testid={`tag-press-card-${index}-${t}`}>{tag}</span>
              </span>
            ))}
          </p>
        )}
        {showLinks && item.link_url && item.link_text && (
          <a
            href={item.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-sm font-medium text-primary mt-1 hover:underline"
            onClick={(event) => event.stopPropagation()}
            data-testid={`link-press-card-${index}`}
          >
            {item.link_text}
            <ArrowRight className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}
