import { useCallback, useEffect, useRef, useState } from "react";
import { IconArrowNarrowRight, IconClock } from "@tabler/icons-react";
import type {
  ListWorkshopsCarouselSection,
  WorkshopCarouselItem,
} from "@shared/schema";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";
import { UniversalImage } from "@/components/UniversalImage";
import { useInternalNav } from "@/hooks/useInternalNav";
import { cn } from "@/lib/utils";
import { coerceToHtml, coerceToText } from "@/lib/variable-manager";

interface ListWorkshopsCarouselProps {
  data: ListWorkshopsCarouselSection;
}

/** Locale code → uppercase label + LocaleFlag (en → EN + US flag, es → ES + ES flag). */
function resolveLangDisplay(item: WorkshopCarouselItem): {
  label: string;
  flagLocale: string;
} | null {
  const override = coerceToText(item.language_label);
  const raw = coerceToText(item.lang).toLowerCase();
  if (raw === "en" || raw === "us") {
    return { label: override || "EN", flagLocale: "en" };
  }
  if (raw === "es") {
    return { label: override || "ES", flagLocale: "es" };
  }
  if (override) return { label: override, flagLocale: raw || "" };
  if (raw) return { label: raw.toUpperCase(), flagLocale: raw };
  return null;
}

function resolveWorkshopCtaUrl(item: WorkshopCarouselItem): string {
  const direct =
    coerceToText(item.cta_url) ||
    coerceToText((item as { url?: unknown }).url);
  if (direct) return direct;

  const slug = coerceToText((item as { slug?: unknown }).slug);
  if (!slug) return "";

  // Learn hosts workshop detail pages (API url is often null).
  const lang = coerceToText(item.lang).toLowerCase();
  const path = lang === "es" ? `/es/workshops/${slug}` : `/workshops/${slug}`;
  return `https://learn.4geeks.com${path}`;
}

function isItemLive(item: WorkshopCarouselItem, now: number): boolean {
  if (typeof item.is_live === "boolean") return item.is_live;
  if (!item.starting_at) return false;
  const start = Date.parse(item.starting_at);
  if (Number.isNaN(start) || start > now) return false;
  if (!item.ending_at) return true;
  const end = Date.parse(item.ending_at);
  return Number.isNaN(end) || end > now;
}

function WorkshopCard({
  item,
  index,
  ctaFallback,
  hostPrefix,
  liveNowLabel,
  live,
}: {
  item: WorkshopCarouselItem;
  index: number;
  ctaFallback?: string;
  hostPrefix?: string;
  liveNowLabel?: string;
  live: boolean;
}) {
  const handleLinkClick = useInternalNav();
  const [hovered, setHovered] = useState(false);
  const title = coerceToText(item.title);
  const description = coerceToText(item.description);
  const ctaLabel = coerceToText(item.cta_label) || coerceToText(ctaFallback);
  const ctaUrl = resolveWorkshopCtaUrl(item);
  const hostName = coerceToText(item.host_name);
  const langDisplay = resolveLangDisplay(item);
  const durationLabel = coerceToText(item.duration_label);
  const startsInLabel = coerceToText(item.starts_in_label);
  const techIds = item.technology_image_ids?.filter(Boolean) ?? [];

  return (
    <article
      className={cn(
        "flex flex-col w-[310px] md:w-[380px] min-w-[280px] shrink-0 rounded-[13px] overflow-hidden select-none text-card-foreground p-5 pb-2 pt-2.5",
        live && "border-primary bg-primary/5",
      )}
      style={{
        background: live ? undefined : "hsl(var(--card))",
        border: live ? "1.5px solid hsl(var(--primary))" : "1.5px solid hsl(var(--border))",
        boxShadow: hovered
          ? "0 1px 5px rgba(0,132,255,0.10), 0 3px 10px rgba(0,132,255,0.06)"
          : "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)",
        transform: hovered ? "translateY(-2px)" : "none",
        transition: "border-color .2s, box-shadow .2s, transform .18s ease",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`workshop-card-${index}`}
    >
      <div className="flex items-center justify-between gap-2 min-h-6 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          {techIds.map((id, techIndex) => (
            <UniversalImage
              key={`${id}-${techIndex}`}
              id={id}
              alt=""
              className="w-5 h-5 object-contain"
              fieldContext={{
                arrayPath: "items",
                index,
                srcField: `technology_image_ids.${techIndex}`,
              }}
            />
          ))}
        </div>
        <div className="flex items-center gap-2.5 shrink-0">
          {durationLabel && (
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-bold text-foreground">
              <IconClock className="w-3.5 h-3.5" aria-hidden />
              {durationLabel}
            </span>
          )}
          {live && liveNowLabel ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-bold text-destructive">
              <span className="w-2 h-2 rounded-full bg-destructive" aria-hidden />
              {liveNowLabel}
            </span>
          ) : startsInLabel ? (
            <span className="text-xs font-bold text-muted-foreground whitespace-nowrap">
              {startsInLabel}
            </span>
          ) : null}
        </div>
      </div>

      <h3
        className="text-xl md:text-[19px] font-heading font-extrabold leading-snug text-foreground line-clamp-2 mb-1"
        data-testid="text-workshop-title"
      >
        {title}
      </h3>

      {description && (
        <p
          className="text-[15px] text-muted-foreground leading-snug line-clamp-3 mb-3"
          data-testid="text-workshop-description"
        >
          {description}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-0.5">
        {hostName ? (
          <div className="flex items-center gap-2.5 min-w-0">
            {item.host_avatar_url ? (
              <div className="w-9 h-9 rounded-full overflow-hidden shrink-0 bg-muted">
                <UniversalImage
                  id={item.host_avatar_url}
                  alt={hostName}
                  className="w-full h-full object-cover"
                  fieldContext={{
                    arrayPath: "items",
                    index,
                    srcField: "host_avatar_url",
                  }}
                />
              </div>
            ) : (
              <div className="w-9 h-9 rounded-full shrink-0 bg-muted flex items-center justify-center text-sm font-bold text-muted-foreground">
                {hostName.charAt(0)}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm leading-tight truncate">
                {hostPrefix}
                {hostName}
              </p>
            </div>
          </div>
        ) : (
          <span />
        )}
        {langDisplay && (
          <div
            className="shrink-0 inline-flex items-center gap-2 text-xs uppercase text-foreground"
            data-testid="workshop-lang"
          >
            <span>{langDisplay.label}</span>
            {langDisplay.flagLocale ? (
              <LocaleFlag
                locale={langDisplay.flagLocale}
                className="w-[15px] h-[15px] rounded-sm"
              />
            ) : null}
          </div>
        )}
      </div>

      {ctaLabel && (
        <>
          <div className="border-t border-border mt-2" />
          <a
            href={ctaUrl}
            onClick={handleLinkClick}
            className="flex items-center justify-center gap-2.5 h-8 pt-1 text-[17px] font-bold tracking-wide text-primary hover:underline"
            data-testid="link-workshop-cta"
          >
            {ctaLabel}
            {live && <IconArrowNarrowRight className="w-6 h-2.5" aria-hidden />}
          </a>
        </>
      )}
    </article>
  );
}

/**
 * Horizontal drag-to-scroll track (Learn MktEventCards / DraggableContainer style).
 * Grab cursor + drag only when content actually overflows.
 */
function useDragScroll(itemCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  const [canDrag, setCanDrag] = useState(false);

  const measureOverflow = useCallback(() => {
    const el = ref.current;
    if (!el) {
      setCanDrag(false);
      return;
    }
    setCanDrag(el.scrollWidth > el.clientWidth + 1);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measureOverflow();
    const ro = new ResizeObserver(measureOverflow);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    window.addEventListener("resize", measureOverflow);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureOverflow);
    };
  }, [itemCount, measureOverflow]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || el.scrollWidth <= el.clientWidth + 1) return;
    drag.current = {
      active: true,
      startX: e.clientX,
      scrollLeft: el.scrollLeft,
      moved: false,
    };
    el.setPointerCapture(e.pointerId);
    el.classList.add("cursor-grabbing");
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el || !drag.current.active) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 4) drag.current.moved = true;
    el.scrollLeft = drag.current.scrollLeft - dx;
  }, []);

  const endDrag = useCallback((e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    drag.current.active = false;
    el.classList.remove("cursor-grabbing");
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  }, []);

  const suppressClickIfDragged = useCallback((e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault();
      e.stopPropagation();
      drag.current.moved = false;
    }
  }, []);

  return { ref, canDrag, onPointerDown, onPointerMove, endDrag, suppressClickIfDragged };
}

export default function ListWorkshopsCarouselDefault({
  data,
}: ListWorkshopsCarouselProps) {
  const items = data.items ?? [];
  const titleHtml = coerceToHtml(data.title);
  const showArrow = data.show_title_arrow !== false;
  const { ref, canDrag, onPointerDown, onPointerMove, endDrag, suppressClickIfDragged } =
    useDragScroll(items.length);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  if (items.length === 0) return null;

  return (
    <section
      className="w-full"
      data-testid="section-list-workshops-carousel"
    >
      {titleHtml && (
        <div className="flex items-center justify-between gap-8 mb-6">
          <h2
            className="text-h2 font-heading font-bold text-foreground"
            dangerouslySetInnerHTML={{ __html: titleHtml }}
            data-testid="text-workshops-heading"
          />
          {showArrow && (
            <IconArrowNarrowRight
              className="hidden sm:block w-14 h-8 text-foreground shrink-0"
              aria-hidden
            />
          )}
        </div>
      )}

      <div
        ref={ref}
        className={cn(
          "overflow-x-auto scrollbar-hide [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          canDrag && "cursor-grab",
        )}
        onPointerDown={canDrag ? onPointerDown : undefined}
        onPointerMove={canDrag ? onPointerMove : undefined}
        onPointerUp={canDrag ? endDrag : undefined}
        onPointerCancel={canDrag ? endDrag : undefined}
        onClickCapture={canDrag ? suppressClickIfDragged : undefined}
        data-testid="workshops-carousel-track"
      >
        <div className="flex gap-5 w-max py-1.5 px-1.5">
          {items.map((item, index) => (
            <WorkshopCard
              key={`${coerceToText(item.title)}-${index}`}
              item={item}
              index={index}
              ctaFallback={data.cta_label}
              hostPrefix={data.host_prefix}
              liveNowLabel={data.live_now_label}
              live={isItemLive(item, now)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
