import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { UniversalImage } from "@/components/UniversalImage";
import { CSSMarquee } from "@/components/ui/CSSMarquee";
import type { TrustCardsSection, TrustCardItem } from "@shared/schema";

const MIN_PILLS_PER_LOOP = 10;
const SECONDS_PER_PILL = 10;

interface TrustCardsMarqueeProps {
  data: TrustCardsSection;
}

function titleHtml(title: string, highlight?: string): string {
  const start = highlight ? title.indexOf(highlight) : -1;
  if (!highlight || start === -1) return title;
  const end = start + highlight.length;
  return `${title.slice(0, start)}<span class="text-primary">${title.slice(start, end)}</span>${title.slice(end)}`;
}

function StarIcon({ fill }: { fill: "full" | "half" | "empty" }) {
  if (fill === "half") {
    return (
      <span className="relative h-3.5 w-3.5">
        <Star className="absolute inset-0 h-3.5 w-3.5 fill-current text-border" />
        <span className="absolute inset-0 overflow-hidden" style={{ width: "50%" }}>
          <Star className="h-3.5 w-3.5 fill-current text-primary" />
        </span>
      </span>
    );
  }
  return <Star className={`h-3.5 w-3.5 fill-current ${fill === "full" ? "text-primary" : "text-border"}`} />;
}

function Stars({ rating, single }: { rating: number; single?: boolean }) {
  if (single) return <StarIcon fill="full" />;
  const rounded = Math.round(rating * 2) / 2;
  return (
    <span className="flex items-center gap-0.5" data-testid="stars-rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <StarIcon
          key={star}
          fill={star <= rounded ? "full" : star - 0.5 === rounded ? "half" : "empty"}
        />
      ))}
    </span>
  );
}

function Pill({
  item,
  index,
  single,
  hidden,
}: {
  item: TrustCardItem;
  index: number;
  single?: boolean;
  hidden?: boolean;
}) {
  return (
    <div
      className="flex flex-shrink-0 items-center gap-4 rounded-full border border-border bg-card px-5 py-3 shadow-sm mx-1.5 md:mx-2 md:px-6"
      aria-label={item.review_count || `${item.rating}`}
      aria-hidden={hidden || undefined}
      data-testid={`pill-trust-${index}`}
    >
      <UniversalImage
        id={item.image}
        alt={item.trusted_text || item.review_count || `Review platform ${index + 1}`}
        className="h-6 md:h-7 w-auto max-w-[90px] md:max-w-[110px]"
        style={{ objectFit: "contain" }}
        loading="lazy"
        fieldContext={{ arrayPath: "items", index, srcField: "image" }}
      />
      <span className="h-6 w-px bg-border" aria-hidden="true" />
      <span className="flex items-center gap-2">
        <Stars rating={item.rating} single={single} />
        <span className="text-sm md:text-base font-bold text-foreground">{item.rating.toFixed(1)}</span>
      </span>
    </div>
  );
}

interface RowEntry {
  item: TrustCardItem;
  index: number;
}

function PillRow({
  entries,
  single,
  direction = "fwd",
  reducedMotion,
}: {
  entries: RowEntry[];
  single?: boolean;
  direction?: "fwd" | "rev";
  reducedMotion: boolean;
}) {
  if (reducedMotion) {
    return (
      <div className="flex overflow-x-auto py-1">
        {entries.map(({ item, index }) => (
          <Pill key={index} item={item} index={index} single={single} />
        ))}
      </div>
    );
  }

  const repeats = Math.max(1, Math.ceil(MIN_PILLS_PER_LOOP / entries.length));
  const loop = Array.from({ length: repeats }, () => entries).flat();

  return (
    <CSSMarquee
      direction={direction}
      speed={loop.length * SECONDS_PER_PILL}
      gradient
      gradientWidth={64}
      pauseOnHover
      className="py-1"
    >
      {loop.map(({ item, index }, i) => (
        <Pill key={i} item={item} index={index} single={single} hidden={i >= entries.length} />
      ))}
    </CSSMarquee>
  );
}

export default function TrustCardsMarquee({ data }: TrustCardsMarqueeProps) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const items = data.items || [];
  const entries = items.map((item, index) => ({ item, index }));

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(query.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    query.addEventListener("change", handler);
    return () => query.removeEventListener("change", handler);
  }, []);

  if (items.length === 0) return null;

  return (
    <section data-testid="section-trust-cards-marquee">
      {(data.title || data.subtitle) && (
        <div className="max-w-6xl mx-auto px-4 text-center mb-6 md:mb-8">
          {data.title && (
            <h2
              className="text-3xl md:text-4xl font-heading font-bold leading-tight text-foreground"
              data-testid="text-trust-cards-title"
              dangerouslySetInnerHTML={{ __html: titleHtml(data.title, data.title_highlight) }}
            />
          )}
          {data.subtitle && (
            <p className="mt-2 text-muted-foreground" data-testid="text-trust-cards-subtitle">
              {data.subtitle}
            </p>
          )}
        </div>
      )}

      <div className="hidden md:block" data-testid="row-trust-cards-desktop">
        <PillRow entries={entries} reducedMotion={reducedMotion} />
      </div>

      <div className="md:hidden space-y-3" data-testid="row-trust-cards-mobile">
        <PillRow entries={entries} single reducedMotion={reducedMotion} />
        <PillRow entries={[...entries].reverse()} single direction="rev" reducedMotion={reducedMotion} />
      </div>
    </section>
  );
}
