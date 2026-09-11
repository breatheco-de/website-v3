
import { createElement, useState, useEffect } from "react";
import { CSSMarquee } from "@/components/ui/CSSMarquee";
import { Button } from "@/components/ui/button";
import UniversalImage from "@/components/UniversalImage";
import { useInternalNav } from "@/hooks/useInternalNav";
import { getIcon } from "@/lib/icons";
import type { HeroCredibility as HeroCredibilityData, HeroCredibilityPill } from "@shared/schema";

interface HeroCredibilityProps {
  data: HeroCredibilityData;
}

// ─── PillLogo ─────────────────────────────────────────────────────────────────

function PillLogo({ imageId, colored, pillIndex, logoIndex }: { 
  imageId: string; 
  colored: boolean;
  pillIndex: number;
  logoIndex: number;
}) {
  return (
    <div>
    <UniversalImage
      id={imageId}
      className="max-w-full max-h-full object-contain"
      style={{ 
        objectFit: "contain",
        filter: colored ? "none" : "grayscale(100%) opacity(0.85)" 
      }}
      loading="eager"
      fieldContext={{
        arrayPath: `pills.${pillIndex}.logos`,
        index: logoIndex,
        srcField: "image_id",
      }}
    />
    </div>
  );
}

// ─── CredibilityPill ──────────────────────────────────────────────────────────

function CredibilityPill({ pill, tick, colored, pillIndex }: { 
  pill: HeroCredibilityPill; 
  tick: number; 
  colored: boolean;
  pillIndex: number;
}) {
  const logos = pill.logos ?? [];
  const activeIdx = logos.length > 0 ? tick % logos.length : 0;

  return (
    <div
      className="flex items-center gap-2 md:gap-3 px-3 md:px-5 rounded-full w-full overflow-hidden flex-shrink-0"
      style={{
        backgroundColor: pill.background_color || "white",
        border: "1.5px solid rgba(0,0,0,0.09)",
        height: "clamp(60px, 8vw, 76px)",
      }}
    >
      {/* Logo area with rotation */}
      {logos.length > 0 && (
        <div className="relative w-12 h-8 md:w-14 md:h-6 flex-shrink-0 flex items-center justify-center">
          {logos.map((logo, i) => (
            <div
              key={logo.image_id + i}
              className="absolute inset-0 flex items-center justify-center transition-opacity duration-300"
              style={{ opacity: i === activeIdx ? 1 : 0 }}
            >
              <PillLogo 
                imageId={logo.image_id} 
                colored={colored}
                pillIndex={pillIndex}
                logoIndex={i}
              />
            </div>
          ))}
        </div>
      )}

      {/* Divider */}
      <div
        className="flex-shrink-0"
        style={{ width: "1px", height: "28px", background: "#D1D5DB" }}
      />

      {/* Category + label */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        <span
          className="uppercase font-semibold leading-none mb-1"
          style={{ fontSize: "9px", letterSpacing: "0.13em", color: "#9CA3AF" }}
        >
          {pill.category}
        </span>
        <p
          className="text-xs md:text-sm font-medium leading-snug m-0"
          style={{
            color: "#111827",
            overflow: "hidden",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
          }}
        >
          {pill.label}
        </p>
      </div>
    </div>
  );
}

// ─── WatermarkMarquee ─────────────────────────────────────────────────────────

const DEFAULT_MARQUEE_ITEMS = [
  { bold_text: "Course Report", light_text: "4.9 \u2605" },
  { bold_text: "SwitchUp", light_text: "4.9 \u2605" },
  { bold_text: "Career Karma", light_text: "4.9 \u2605" },
  { bold_text: "Google", light_text: "4.8 \u2605" },
  { bold_text: "5,000+", light_text: "graduates employed worldwide" },
  { bold_text: "55%", light_text: "avg salary increase" },
];

function WatermarkMarquee({ items, isStatic }: { items: { bold_text: string; light_text: string }[]; isStatic?: boolean }) {
  const itemNodes = items.map((item, i) => (
    <span
      key={i}
      className="flex items-center gap-2 mx-4 md:ml-0 md:mr-10 text-xs whitespace-nowrap"
    >
      <span className="font-extrabold text-muted-foreground">{item.bold_text}</span>
      <span className="text-muted-foreground/80">{item.light_text}</span>
    </span>
  ));

  if (isStatic) {
    return (
      <div className="w-full mt-7 flex flex-wrap gap-y-2 justify-center md:justify-start items-center">
        {itemNodes}
      </div>
    );
  }

  return (
    <div className="w-full mt-10">
      <CSSMarquee speed={42} gradient={true} gradientWidth={100}>
        {itemNodes}
      </CSSMarquee>
    </div>
  );
}

// ─── HeroCredibility ──────────────────────────────────────────────────────────

export default function HeroCredibility({ data }: HeroCredibilityProps) {
  const handleLinkClick = useInternalNav();
  const pills = data.pills ?? [];
  const showMarquee = data.show_marquee ?? true;
  const marqueeStatic = data.marquee_static ?? false;
  const marqueeItems = data.marquee_items?.length ? data.marquee_items : DEFAULT_MARQUEE_ITEMS;
  const rotationMs = data.logo_rotation_ms_time ?? 2500;
  const coloredLogos = data.colored_logos ?? false;

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const hasManyLogos = pills.some((p) => (p.logos ?? []).length > 1);
    if (!hasManyLogos) return;
    const timer = setInterval(() => setTick((t) => t + 1), rotationMs);
    return () => clearInterval(timer);
  }, [pills, rotationMs]);

  return (
    <section data-testid="section-hero-credibility" className="max-w-6xl mx-auto">
      <div className="flex flex-col px-4 md:px-10 pt-10 pb-6 w-full max-w-[1200px] mx-auto">
        <div className="flex flex-col lg:flex-row items-stretch justify-between gap-8">

          {/* ── LEFT COLUMN ── */}
          <div className="flex flex-1 min-w-0 flex-col gap-8 lg:max-w-[55%] items-center lg:items-start">
            <div className="flex flex-col gap-3 w-full">
              {/* Title: first on mobile (order-1), second on desktop (order-2) */}
              <h1
                className="order-1 lg:order-2 text-foreground text-center lg:text-left font-inter"
                data-testid="text-hero-title"
              >
                {/* Mobile: RTE HTML without font-size/line-height, br stripped */}
                <div
                  className="block lg:hidden text-[50px] md:text-6xl leading-[1.05]"
                  dangerouslySetInnerHTML={{
                    __html: (data.title || "")
                      .replace(/font-size\s*:[^;"]*(;)?/gi, "")
                      .replace(/line-height\s*:[^;"]*(;)?/gi, "")
                      .replace(/<br\s*\/?>/gi, " ")
                  }}
                />
                {/* Desktop: full RTE HTML */}
                <div
                  className="hidden lg:block leading-[1.03]"
                  dangerouslySetInnerHTML={{ __html: data.title || "" }}
                />
              </h1>
              {/* Description: second on mobile (order-2), first on desktop (order-1) */}
              {data.description && (
                <div
                  className="order-2 md:order-1 text-muted-foreground leading-relaxed text-center lg:text-left"
                  data-testid="text-hero-description"
                >
                  {/* Mobile: strip font-size and br */}
                  <div
                    className="block lg:hidden"
                    dangerouslySetInnerHTML={{
                      __html: data.description
                        .replace(/font-size\s*:[^;"]*(;)?/g, "")
                        .replace(/<br\s*\/?>/gi, " ")
                    }}
                  />
                  {/* Desktop: full RTE HTML */}
                  <div
                    className="hidden lg:block"
                    dangerouslySetInnerHTML={{ __html: data.description }}
                  />
                </div>
              )}
            </div>

            {data.cta_buttons && data.cta_buttons.length > 0 && (
              <div
                className="flex items-center justify-center lg:justify-start gap-3 flex-wrap"
                data-testid="hero-cta-buttons"
              >
                {data.cta_buttons.map((button, index) => (
                  <Button
                    key={index}
                    variant={button.variant === "primary" ? "default" : button.variant}
                    className="px-3 md:px-6"
                    asChild
                    data-testid={`button-hero-cta-${index}`}
                  >
                    <a href={button.url} onClick={handleLinkClick} className="flex items-center gap-2">
                      {button.icon && (() => {
                        const Ic = getIcon(button.icon);
                        return Ic ? createElement(Ic, { className: "h-4 w-4" }) : null;
                      })()}
                      {button.text}
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </div>

          {/* ── RIGHT COLUMN — credibility pills ── */}
          {pills.length > 0 && (() => {
            const pillsInner = (
              <div className="relative">
                {data.pills_url && (
                  <div
                    className="pointer-events-none absolute -inset-6 rounded-2xl transition-colors group-hover:bg-secondary/50"
                    aria-hidden="true"
                  />
                )}
                <div className="relative z-10 flex flex-col gap-3 lg:gap-5">
                  {pills.map((pill, i) => (
                    <CredibilityPill key={i} pill={pill} tick={tick} colored={coloredLogos} pillIndex={i} />
                  ))}
                </div>
              </div>
            );

            return (
              <div
                className="flex flex-col justify-center w-full lg:w-[430px] lg:flex-shrink-0"
                data-testid="hero-credibility-pills"
              >
                {data.pills_url ? (
                  <a
                    href={data.pills_url}
                    onClick={handleLinkClick}
                    className="group lg:-my-[150px] lg:-ms-[150px] lg:py-[150px] lg:ps-[150px] block"
                    data-testid="hero-credibility-pills-link"
                  >
                    {pillsInner}
                  </a>
                ) : (
                  pillsInner
                )}
              </div>
            );
          })()}
        </div>

        {/* ── WATERMARK MARQUEE ── */}
        {showMarquee && <WatermarkMarquee items={marqueeItems} isStatic={marqueeStatic} />}
      </div>
    </section>
  );
}
