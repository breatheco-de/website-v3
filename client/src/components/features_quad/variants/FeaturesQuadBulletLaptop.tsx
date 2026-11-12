import { useEffect, useRef, useState } from "react";
import type { FeatureQuadSection } from "@shared/schema";
import UniversalImage from "@/components/UniversalImage";
import { cn } from "@/lib/utils";

// Direct URL, not a registry id: visitors only receive registry ids referenced in page content.
const STOCK_LAPTOP_IMAGE_URL = "https://storage.googleapis.com/4geeks-academy-website/media/laptop.avif";

const BADGE_OFFSETS = ["lg:ml-0", "lg:ml-14", "lg:ml-4", "lg:ml-20"];
// Highlight steps through every badge while scroll progress moves between these two points.
const HIGHLIGHT_START = 0.25;
const HIGHLIGHT_END = 0.75;
// Total vertical drift per badge over the section's pass through the viewport; mixed signs and sizes read as depth.
const PARALLAX_TRAVEL_PX = [-48, 32, -24, 56];

interface FeaturesQuadBulletLaptopProps {
  data: FeatureQuadSection;
}

type LaptopBadge = NonNullable<FeatureQuadSection["laptop_badges"]>[number];

function renderHeading(heading: string, highlight?: string) {
  const start = highlight ? heading.indexOf(highlight) : -1;
  if (!highlight || start === -1) return heading;
  const end = start + highlight.length;
  return (
    <>
      {heading.slice(0, start)}
      <span className="block text-primary">{heading.slice(start, end)}</span>
      {heading.slice(end)}
    </>
  );
}

function Badge({
  badge,
  index,
  active,
  wrapperRef,
}: {
  badge: LaptopBadge;
  index: number;
  active: boolean;
  wrapperRef: (el: HTMLSpanElement | null) => void;
}) {
  return (
    // Parallax lives on the wrapper so its transform does not fight the highlight scale.
    <span
      ref={wrapperRef}
      className={cn("inline-flex will-change-transform", BADGE_OFFSETS[index % BADGE_OFFSETS.length])}
    >
      <span
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium shadow-sm transition-all duration-700 ease-out lg:gap-3 lg:px-6 lg:py-3 lg:text-base",
          active
            ? "border-primary bg-primary text-primary-foreground shadow-lg scale-105"
            : "border-primary/20 bg-card text-primary opacity-80",
        )}
        data-testid={`badge-features-quad-laptop-${index}`}
        data-active={active || undefined}
      >
        <span
          className={cn(
            "w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors duration-700 lg:w-3 lg:h-3",
            badge.dot !== "green" && (active ? "bg-primary-foreground" : "bg-primary"),
          )}
          style={badge.dot === "green" ? { background: "hsl(var(--color-green))" } : undefined}
        />
        {badge.text}
      </span>
    </span>
  );
}

/**
 * Scroll progress of the section through the viewport (0 = top edge enters at the bottom, 1 = bottom edge
 * leaves at the top) drives which badge is highlighted and a per-badge vertical parallax. Listens only
 * while the section is on screen.
 */
function useScrollDrivenBadges(count: number) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const badgeRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || count === 0) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    const update = () => {
      frame = 0;
      const rect = section.getBoundingClientRect();
      const vh = window.innerHeight;
      const progress = Math.min(1, Math.max(0, (vh - rect.top) / (vh + rect.height)));
      const window01 = (progress - HIGHLIGHT_START) / (HIGHLIGHT_END - HIGHLIGHT_START);
      const next = Math.min(count - 1, Math.max(0, Math.floor(window01 * count)));
      setActive((prev) => (prev === next ? prev : next));
      if (reduceMotion) return;
      badgeRefs.current.forEach((el, i) => {
        if (!el) return;
        const travel = PARALLAX_TRAVEL_PX[i % PARALLAX_TRAVEL_PX.length];
        el.style.transform = `translate3d(0, ${((0.5 - progress) * travel).toFixed(1)}px, 0)`;
      });
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };

    let listening = false;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !listening) {
        listening = true;
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll);
        onScroll();
      } else if (!entry.isIntersecting && listening) {
        listening = false;
        window.removeEventListener("scroll", onScroll);
        window.removeEventListener("resize", onScroll);
      }
    });
    observer.observe(section);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [count]);

  const setBadgeRef = (index: number) => (el: HTMLSpanElement | null) => {
    badgeRefs.current[index] = el;
  };
  return { sectionRef, setBadgeRef, active };
}

interface Screen {
  imageId: string;
  alt: string;
  fieldContext: { fieldPath: string } | { arrayPath: string; index: number; srcField: string };
}

function collectScreens(data: FeatureQuadSection, badges: LaptopBadge[]) {
  const fallback: Screen | null = data.screen_image?.image_id
    ? { imageId: data.screen_image.image_id, alt: data.screen_image.alt ?? "", fieldContext: { fieldPath: "screen_image.image_id" } }
    : null;
  const badgeScreens: (Screen | null)[] = badges.map((badge, index) =>
    badge.image_id
      ? { imageId: badge.image_id, alt: badge.alt ?? badge.text, fieldContext: { arrayPath: "laptop_badges", index, srcField: "image_id" } }
      : null,
  );
  const defaultScreen = fallback ?? badgeScreens.find((s): s is Screen => s !== null) ?? null;
  return { fallback, badgeScreens, defaultScreen };
}

function Laptop({ data, badges, activeBadge }: { data: FeatureQuadSection; badges: LaptopBadge[]; activeBadge: number }) {
  const { fallback, badgeScreens, defaultScreen } = collectScreens(data, badges);
  if (!defaultScreen) {
    return (
      <UniversalImage
        id={STOCK_LAPTOP_IMAGE_URL}
        alt={data.heading ?? "Laptop"}
        className="w-full h-auto object-contain"
        data-testid="img-features-quad-laptop"
        fieldContext={{ fieldPath: "screen_image.image_id" }}
      />
    );
  }
  const current = badgeScreens[activeBadge] ?? defaultScreen;
  const layers = [fallback, ...badgeScreens].filter(
    (s, i, all): s is Screen => s !== null && all.findIndex((o) => o?.imageId === s.imageId) === i,
  );
  return (
    <div data-testid="img-features-quad-laptop">
      <div className="rounded-t-xl bg-foreground p-2 lg:p-3">
        <div className="relative aspect-[16/10] overflow-hidden rounded-sm bg-background">
          {layers.map((screen) => {
            const visible = screen.imageId === current.imageId;
            return (
              <div
                key={screen.imageId}
                className={cn("absolute inset-0 transition-opacity duration-700 ease-out", visible ? "opacity-100" : "opacity-0")}
                aria-hidden={!visible}
              >
                <UniversalImage
                  id={screen.imageId}
                  alt={visible ? screen.alt : ""}
                  className="w-full h-full object-cover object-top"
                  fieldContext={screen.fieldContext}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="h-2.5 lg:h-3.5 -mx-[3%] rounded-b-xl bg-input" />
    </div>
  );
}

export default function FeaturesQuadBulletLaptop({ data }: FeaturesQuadBulletLaptopProps) {
  const cards = data.cards ?? [];
  const badges = data.laptop_badges ?? [];
  const { sectionRef, setBadgeRef, active: activeBadge } = useScrollDrivenBadges(badges.length);
  // Bullet N and badge N cover the same topic, so they share the scroll-driven highlight.
  const syncBullets = badges.length > 0;

  return (
    <section ref={sectionRef} className="overflow-hidden" data-testid="section-features-quad-bullet-laptop">
      <div className="max-w-6xl mx-auto px-4 grid gap-12 lg:grid-cols-[5fr_7fr] lg:gap-16 items-center">
        <div>
          {data.heading && (
            <h2 className="text-3xl md:text-4xl font-heading font-bold leading-tight text-foreground" data-testid="text-features-quad-heading">
              {renderHeading(data.heading, data.heading_highlight)}
            </h2>
          )}
          {data.description && (
            <p className="text-body text-muted-foreground mt-4">{data.description}</p>
          )}
          {cards.length > 0 && (
            <ul className="mt-10 space-y-8" data-testid="list-features-quad-bullets">
              {cards.map((card, index) => {
                const active = syncBullets && index === activeBadge;
                return (
                  <li
                    key={index}
                    className={cn(
                      "flex gap-4 transition-opacity duration-700 ease-out",
                      syncBullets && !active && "opacity-50",
                    )}
                    data-testid={`features-quad-bullet-${index}`}
                    data-active={active || undefined}
                  >
                    <span
                      className={cn(
                        "mt-2.5 w-1.5 h-1.5 rounded-full bg-primary flex-shrink-0 transition-transform duration-700 ease-out",
                        active && "scale-[2]",
                      )}
                    />
                    <div>
                      {card.title && (
                        <h3
                          className={cn(
                            "text-lg font-semibold transition-colors duration-700 ease-out",
                            active ? "text-primary" : "text-foreground",
                          )}
                        >
                          {card.title}
                        </h3>
                      )}
                      {card.description && (
                        <p className="mt-1 text-base text-muted-foreground">{card.description}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="relative -mr-4 lg:mr-[min(-1rem,calc((72rem-100vw)/2-1rem))]">
          <div className="rounded-l-3xl bg-primary/5 p-5 pr-8 lg:py-20 lg:pl-14 lg:pr-0">
            {badges.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-5 lg:absolute lg:-left-16 lg:top-10 lg:z-10 lg:flex-col lg:items-start lg:gap-5 lg:mb-0">
                {badges.map((badge, index) => (
                  <Badge
                    key={index}
                    badge={badge}
                    index={index}
                    active={index === activeBadge}
                    wrapperRef={setBadgeRef(index)}
                  />
                ))}
              </div>
            )}
            <div className="lg:w-[115%]">
              <Laptop data={data} badges={badges} activeBadge={activeBadge} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
