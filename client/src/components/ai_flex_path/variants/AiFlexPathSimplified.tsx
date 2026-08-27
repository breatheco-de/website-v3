import { useState, useEffect } from "react";
import { IconBookFilled } from "@tabler/icons-react";
import { getIcon } from "@/lib/icons";
import UniversalImage from "@/components/UniversalImage";
import { InternalLink } from "@/components/InternalLink";
import { resolveColorVar, hslColor, type ResolvedColor } from "@/components/course_selector/shared";
import type { AiFlexPathSimplified } from "@shared/schema";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Course = AiFlexPathSimplified["courses"][0];
type CtaButton = NonNullable<Course["cta_buttons"]>[number];

/**
 * CTA button with the exact same shape/size as the global Button component,
 * but with colors adapted to the course's slot color.
 * Inline styles always win over Tailwind class rules (including pseudo-classes),
 * so we use buttonVariants for shape and override only color props via style.
 */
function SlottedCtaButton({
  btn,
  resolved,
  size = "md",
}: {
  btn: CtaButton;
  resolved: ResolvedColor;
  size?: "sm" | "md";
}) {
  const [hov, setHov] = useState(false);
  const BtnIcon = btn.icon ? getIcon(btn.icon) : null;
  const variant = btn.variant ?? "primary";
  const bSize = size === "sm" ? "sm" : "default";

  // Shape/layout from the global button system — color overridden below via inline style
  const bVariant = variant === "primary" ? "default"
    : variant === "outline" ? "outline"
    : "link";
  const shapeClass = cn(buttonVariants({ variant: bVariant, size: bSize }), "font-semibold no-default-hover-elevate");

  let colorStyle: React.CSSProperties;
  if (variant === "primary") {
    colorStyle = {
      background: hslColor(resolved, 0.75),
      borderColor: hslColor(resolved, 0.75),
      color: "#fff",
    };
  } else if (variant === "outline") {
    // Same look as the "View details" button
    colorStyle = {
      background: "transparent",
      border: `1.5px solid ${hslColor(resolved, 0.45)}`,
      color: hslColor(resolved, 1),
      transform: hov ? "scale(1.04)" : "scale(1)",
    };
  } else {
    // link — keep hover:bg-muted from Tailwind but override the text color
    colorStyle = {
      color: hslColor(resolved, 1),
    };
  }

  return (
    <InternalLink
      href={btn.url}
      className={shapeClass}
      style={colorStyle}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {btn.text}
      {BtnIcon && <BtnIcon size={bSize === "sm" ? 12 : 14} />}
    </InternalLink>
  );
}

const DEFAULT_COURSE_COLORS = [
  "hsl(0 84% 60%)",
  "hsl(45 96% 53%)",
  "hsl(142 71% 45%)",
  "hsl(330 80% 62%)",
];

function getSlotColor(slotIndex: number, colors: string[] = DEFAULT_COURSE_COLORS): ResolvedColor {
  return resolveColorVar(colors[slotIndex % colors.length]);
}

function SkillBar({
  name,
  skill_percentage,
  animate,
  resolved,
}: {
  name: string;
  skill_percentage: number;
  animate: boolean;
  resolved: ResolvedColor;
}) {
  const [width, setWidth] = useState(0);
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (animate) {
      const t = setTimeout(() => setWidth(skill_percentage), 60);
      return () => clearTimeout(t);
    } else {
      setWidth(0);
    }
  }, [animate, skill_percentage]);

  return (
    <div
      className="flex items-center gap-2"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <span
        className="text-[11px] whitespace-nowrap overflow-hidden text-ellipsis transition-colors duration-150"
        style={{ minWidth: 120, color: hovered ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground) / 0.5)" }}
      >
        {name}
      </span>
      <div
        className="flex-1 rounded-full overflow-hidden transition-all duration-150"
        style={{ height: hovered ? 6 : 4, background: "hsl(var(--muted))" }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${width}%`,
            background: hovered ? hslColor(resolved, 0.7) : hslColor(resolved, 1),
            transitionProperty: "width, background",
            transitionDuration: "650ms, 180ms",
            transitionTimingFunction: "cubic-bezier(.4,0,.2,1)",
          }}
        />
      </div>
      <span
        className="text-[10px] tabular-nums transition-colors duration-150"
        style={{ minWidth: 26, textAlign: "right", color: hovered ? "hsl(var(--muted-foreground))" : "hsl(var(--muted-foreground) / 0.3)" }}
      >
        {skill_percentage}%
      </span>
    </div>
  );
}

const COURSE_MARQUEE_COPIES = 8;
const COURSE_MARQUEE_PCT = (100 / COURSE_MARQUEE_COPIES).toFixed(6);

function CourseToolsMarquee({ tools, resolved }: { tools: string[]; resolved: ResolvedColor }) {
  const duration = Math.max(5, tools.length * 1.8);
  return (
    <>
      <style>{`
        @keyframes course-tools-loop-simplified {
          from { transform: translateX(0); }
          to   { transform: translateX(-${COURSE_MARQUEE_PCT}%); }
        }
      `}</style>
      <div
        style={{
          position: "relative",
          height: 26,
          overflow: "hidden",
          WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)",
          maskImage: "linear-gradient(to right, transparent 0%, black 7%, black 93%, transparent 100%)",
          marginBottom: 10,
        }}
      >
        <div
          className="mt-0.5"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            display: "flex",
            animation: `course-tools-loop-simplified ${duration}s linear infinite`,
          }}
        >
          {Array.from({ length: COURSE_MARQUEE_COPIES }, (_, ci) =>
            tools.map((tool, ti) => (
              <span
                key={`${ci}-${ti}`}
                style={{
                  fontFamily: "'SF Mono','Fira Code',monospace",
                  fontSize: "10px",
                  fontWeight: 600,
                  padding: "3px 8px",
                  borderRadius: "9999px",
                  whiteSpace: "nowrap",
                  color: hslColor(resolved, 1),
                  background: hslColor(resolved, 0.1),
                  marginRight: 5,
                  flexShrink: 0,
                }}
              >
                {tool}
              </span>
            ))
          )}
        </div>
      </div>
    </>
  );
}

function PathItem({
  course,
  index,
  slotColors,
  viewDetailsLabel,
  showDetails,
  showMarkers,
}: {
  course: Course;
  index: number;
  slotColors: string[];
  viewDetailsLabel?: string;
  showDetails: boolean;
  showMarkers: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [hovered, setHovered] = useState(false);

  const resolved = getSlotColor(index, slotColors);
  const CourseIcon = course.icon ? getIcon(course.icon) : null;
  const MarkerIcon = course.marker?.icon ? getIcon(course.marker.icon) : null;
  const ctaButtons = course.cta_buttons ?? [];
  const tools = course.tools ?? [];

  // show_details=true → max 4 in header (rest revealed in expanded panel)
  // show_details=false → all tools always visible
  const toolsInHeader = showDetails ? tools.slice(0, 4) : tools;

  const pathCardShadow = hovered
    ? `0 3px 10px ${hslColor(resolved, 0.13)}, 0 8px 22px ${hslColor(resolved, 0.08)}`
    : "0 1px 4px rgba(0,0,0,0.09), 0 4px 14px rgba(0,0,0,0.07)";

  return (
    <div className="relative">
      <div className="relative flex md:flex-row md:gap-5 md:items-center">

        {/* Desktop marker circle — only rendered when showMarkers=true and marker exists */}
        {showMarkers && (
          <div className="hidden md:flex flex-shrink-0 z-10 items-center justify-center" style={{ width: 32 }}>
            {course.marker && (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
              >
                {MarkerIcon ? <MarkerIcon size={15} /> : (course.marker.text ?? "")}
              </div>
            )}
          </div>
        )}

        <div
          className="relative z-10 flex-1 w-full my-[4px] md:my-[6px] rounded-[13px]"
          style={{
            background: "hsl(var(--background))",
            border: "2px solid transparent",
            boxShadow: pathCardShadow,
            transform: hovered ? "translateY(-2px)" : "none",
            transition: "transform 180ms ease, box-shadow 200ms",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {/* Mobile marker badge — top-right, only if marker exists and showMarkers=true */}
          {showMarkers && course.marker && (
            <div className="md:hidden absolute top-3 right-3 z-20">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
                style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
              >
                {MarkerIcon ? <MarkerIcon size={12} /> : (course.marker.text ?? "")}
              </div>
            </div>
          )}

          {/* Main card content */}
          <div className="flex flex-col gap-2 md:gap-3 px-3 pt-3 pb-2.5 md:px-[15px] md:pt-[14px] md:pb-[12px] md:flex-row md:items-start md:gap-[10px]">
            <div className="flex-1 min-w-0 w-full">
              {/* Title row */}
              <div className="flex items-start gap-[6px] mb-[4px] w-full pr-20 md:pr-0">
                <div className="shrink-0 scale-90 md:scale-100 origin-top-left">
                  {CourseIcon
                    ? <CourseIcon size={17} style={{ color: hslColor(resolved, 1) }} />
                    : <IconBookFilled size={17} style={{ color: hslColor(resolved, 1) }} />
                  }
                </div>
                <div className="text-[14px] md:text-[16px] font-extrabold leading-[1.3] flex-1 min-w-0" style={{ color: "hsl(var(--foreground))" }}>
                  {course.name}
                </div>
              </div>

              {/* Tagline */}
              {course.tagline && (
                <div className="text-[12px] md:text-[14px] leading-[1.4] mb-[8px] w-full pr-20 md:pr-0 md:pl-[23px]" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
                  {course.tagline}
                </div>
              )}

              {/* Tools + mobile view-details button */}
              <div className="flex items-center justify-between gap-2 w-[calc(100%+1.5rem)] -mx-3 px-3 md:mx-0 md:w-full md:px-0 md:pl-[23px] md:justify-start">
                <div className="flex flex-wrap items-center gap-[5px] min-w-0">
                  {toolsInHeader.map((tool, toolIdx) => (
                    <span
                      key={tool}
                      className={`text-[9px] md:text-[10px] font-semibold px-[6px] md:px-[7px] py-[2px] rounded-full whitespace-nowrap ${showDetails && toolIdx >= 3 ? "hidden md:inline-flex" : "inline-flex"}`}
                      style={{
                        color: hslColor(resolved, 1),
                        background: hslColor(resolved, 0.1),
                        ...(showDetails ? {
                          transition: "opacity 160ms ease 60ms, transform 200ms cubic-bezier(.4,0,.8,1) 0ms",
                          opacity: expanded ? 0 : 1,
                          transform: expanded ? "translateY(145px) scale(0.6)" : "translateY(0) scale(1)",
                        } : {}),
                      }}
                    >
                      {tool}
                    </span>
                  ))}
                </div>
                {/* Mobile view-details button */}
                {showDetails && viewDetailsLabel && (
                  <div
                    className="md:hidden inline-flex items-center gap-[5px] text-[11px] font-semibold px-[9px] py-[4px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap flex-shrink-0"
                    style={{
                      color: hslColor(resolved, 1),
                      background: "transparent",
                      border: `1.5px solid ${hslColor(resolved, 0.45)}`,
                    }}
                    onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
                  >
                    {viewDetailsLabel}
                    <span className="text-[12px] leading-none transition-transform duration-200" style={{ display: "inline-block", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
                  </div>
                )}
              </div>

              {/* Mobile CTA buttons */}
              {ctaButtons.length > 0 && (
                <div className="md:hidden flex flex-wrap items-center gap-2 mt-2 pl-[23px]">
                  {ctaButtons.map((btn, i) => (
                    <SlottedCtaButton key={i} btn={btn} resolved={resolved} size="sm" />
                  ))}
                </div>
              )}
            </div>

            {/* Desktop right column: hrs pill top · CTA centered · view-details below CTA */}
            <div className="hidden md:flex md:flex-col md:items-end md:justify-between md:w-auto flex-shrink-0 md:self-stretch">
              {course.hrs && (
                <div
                  className="text-[9px] px-[6px] py-[2px] rounded-full font-semibold whitespace-nowrap"
                  style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.12) }}
                >
                  {course.hrs}
                </div>
              )}
              {/* view-details (left) + CTA (right), pinned to bottom */}
              <div className="flex items-center gap-2 mt-auto">
                {showDetails && viewDetailsLabel && (
                  <div
                    className="inline-flex items-center gap-[5px] text-[12px] font-semibold px-[11px] py-[5px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap"
                    style={{
                      color: hslColor(resolved, 1),
                      background: "transparent",
                      border: `1.5px solid ${hslColor(resolved, 0.45)}`,
                      transform: btnHovered ? "scale(1.04)" : "scale(1)",
                    }}
                    onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
                    onMouseEnter={() => setBtnHovered(true)}
                    onMouseLeave={() => setBtnHovered(false)}
                  >
                    {viewDetailsLabel}
                    <span className="text-[13px] leading-none transition-transform duration-200" style={{ display: "inline-block", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
                  </div>
                )}
                {ctaButtons.map((btn, i) => (
                  <SlottedCtaButton key={i} btn={btn} resolved={resolved} size="sm" />
                ))}
              </div>
            </div>
          </div>

          {/* Expandable skills + tools marquee (only when show_details=true) */}
          {showDetails && viewDetailsLabel && (
            <div
              className="overflow-hidden transition-all duration-300"
              style={{
                maxHeight: expanded ? 300 : 0,
                borderTop: `1px solid ${hslColor(resolved, expanded ? 0.15 : 0)}`,
              }}
            >
              <div className="px-[13px] pt-[10px] pb-[10px] flex flex-col gap-2">
                {course.skills?.map((s) => (
                  <SkillBar key={s.name} name={s.name} skill_percentage={s.skill_percentage} animate={expanded} resolved={resolved} />
                ))}
              </div>
              {tools.length > 0 && (
                <CourseToolsMarquee tools={tools} resolved={resolved} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AiFlexPathSimplified({ data }: { data: AiFlexPathSimplified }) {
  const slotColors = data.slot_colors?.length
    ? data.slot_colors.map((s) => s.color)
    : DEFAULT_COURSE_COLORS;

  const showDetails = data.show_details ?? false;
  const viewDetailsLabel = data.view_details_label;

  const SectionIcon = data.icon ? getIcon(data.icon) : null;

  function renderSectionMedia(size: "sm" | "lg") {
    if (data.image_id) {
      return (
        <UniversalImage
          id={data.image_id}
          style={{ objectFit: "contain", width: "40px", height: "40px" }}
        />
      );
    }
    if (SectionIcon) {
      const px = size === "sm" ? "28" : "55";
      return <SectionIcon width={px} height={px} style={{ color: "hsl(var(--foreground))" }} />;
    }
    return null;
  }

  const hasSectionMedia = Boolean(data.image_id || SectionIcon);

  return (
    <div className="pb-16" style={{ fontFamily: "'Inter Variable',system-ui,-apple-system,sans-serif" }}>
      <div className="mx-auto">
        <div className="flex">
          <div className="hidden md:flex w-16 lg:w-28 flex-shrink-0 items-start justify-center pt-[2px]">
            <div className="mt-3">{renderSectionMedia("lg")}</div>
          </div>
          <div className="flex-1 min-w-0 md:mr-16 lg:mr-28">
            <div className="mb-[0.2rem]">
              {hasSectionMedia && (
                <div className="flex justify-center mb-2 md:hidden">
                  {renderSectionMedia("sm")}
                </div>
              )}
              <div className="text-center md:text-left">
                {data.ready_label && (
                  <div className="text-[11px] font-bold tracking-[0.09em] uppercase mb-1 md:mb-0" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
                    {data.ready_label}
                  </div>
                )}
                <div
                  className="text-[22px] md:text-[30px] font-bold tracking-[-0.03em] leading-[1.1]"
                  style={{ color: "hsl(var(--foreground))" }}
                >
                  {data.path_name}
                </div>
              </div>
            </div>

            {data.tagline && (
              <div className="text-[12px] md:text-[13px] mb-2 text-center md:text-left" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
                {data.tagline}
              </div>
            )}

            {data.results_subtitle && (
              <div className="hidden md:block text-[10px] md:text-[11px] font-bold tracking-[0.09em] uppercase mb-4" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
                {data.results_subtitle}
              </div>
            )}

            <div className="mb-3">
              <div className="flex flex-col">
                {data.courses.map((course, i) => (
                  <PathItem
                    key={`${course.name}-${i}`}
                    course={course}
                    index={i}
                    slotColors={slotColors}
                    viewDetailsLabel={viewDetailsLabel}
                    showDetails={showDetails}
                    showMarkers={data.show_markers ?? true}
                  />
                ))}
              </div>
            </div>

            {/* CTA block — same as CourseColorSelector */}
            {data.cta && (
              data.cta.banner ? (
                <div
                  className="rounded-[13px] px-4 py-4 md:px-[1.4rem] md:py-[1.2rem] flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4 mt-6 md:mt-[20px]"
                  style={{
                    background: "hsl(var(--primary))",
                    boxShadow: "0 4px 16px hsl(var(--primary) / 0.25)",
                  }}
                >
                  <div>
                    <div className="text-[14px] md:text-[15px] font-bold leading-snug md:mb-[2px]" style={{ color: "hsl(var(--primary-foreground))" }}>
                      {data.cta.title}
                    </div>
                    {data.cta.subtitle && (
                      <div className="hidden md:block text-[12px]" style={{ color: "hsl(var(--primary-foreground) / 0.6)" }}>
                        {data.cta.subtitle}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-3 md:flex-shrink-0">
                    {data.cta.subtitle ? (
                      <div className="text-[11px] leading-snug flex-1 min-w-0 md:hidden max-w-64" style={{ color: "hsl(var(--primary-foreground) / 0.6)" }}>
                        {data.cta.subtitle}
                      </div>
                    ) : (
                      <div className="flex-1 min-w-0 md:hidden" />
                    )}
                    <div className="flex gap-2 flex-shrink-0">
                      {data.cta.buttons.map((btn, i) => (
                        <InternalLink
                          key={i}
                          href={btn.url}
                          className="rounded-[8px] px-4 py-2 md:px-[18px] md:py-[10px] text-[12px] md:text-[13px] font-bold cursor-pointer whitespace-nowrap flex-shrink-0 transition-opacity duration-150 hover:opacity-90"
                          style={{ background: "hsl(var(--background))", color: "hsl(var(--primary))", textDecoration: "none" }}
                        >
                          {btn.text}
                        </InternalLink>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-4 mt-[35px]">
                  <div className="flex gap-2 flex-shrink-0">
                    {data.cta.buttons.map((btn, i) => (
                      <InternalLink
                        key={i}
                        href={btn.url}
                        className="rounded-[8px] px-[22px] py-[10px] text-[13px] font-bold cursor-pointer whitespace-nowrap flex-shrink-0 transition-opacity duration-150 hover:opacity-90"
                        style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", textDecoration: "none" }}
                      >
                        {btn.text}
                      </InternalLink>
                    ))}
                  </div>
                  <div>
                    <div className="text-[15px] font-bold mb-[2px]" style={{ color: "hsl(var(--foreground))" }}>
                      {data.cta.title}
                    </div>
                    {data.cta.subtitle && (
                      <div className="text-[12px]" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
                        {data.cta.subtitle}
                      </div>
                    )}
                  </div>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
