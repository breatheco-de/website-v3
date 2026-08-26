import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  pointerWithin,
  type DragEndEvent,
  type DragStartEvent,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { IconArrowsExchange, IconBookFilled } from "@tabler/icons-react";
import { CSSMarquee } from "@/components/ui/CSSMarquee";
import { getIcon } from "@/lib/icons";
import UniversalImage from "@/components/UniversalImage";
import { useInternalNav } from "@/hooks/useInternalNav";
import { resolveColorVar, hslColor, type ResolvedColor } from "@/components/course_selector/shared";
import type { AiFlexPathCourseColorSelector } from "@shared/schema";

type Course = AiFlexPathCourseColorSelector["courses"][0];

const DEFAULT_COURSE_COLORS = [
  "hsl(0 84% 60%)",
  "hsl(45 96% 53%)",
  "hsl(142 71% 45%)",
  "hsl(330 80% 62%)",
];

// Color by slot position (not by course)
function getSlotColor(slotIndex: number, colors: string[] = DEFAULT_COURSE_COLORS): ResolvedColor {
  return resolveColorVar(colors[slotIndex % colors.length]);
}

// Primary color for available (non-path) course cards
const PRIMARY_RESOLVED: ResolvedColor = resolveColorVar("hsl(var(--primary))");

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
        @keyframes course-tools-loop {
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
            animation: `course-tools-loop ${duration}s linear infinite`,
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
  total,
  isOver,
  isDragActive,
  isSwapMode,
  revealed,
  dropKey,
  activeCourse,
  viewDetailsLabel,
  replaceLabel,
  slotColors,
  onSwapSlotClick,
}: {
  course: Course;
  index: number;
  total: number;
  isOver: boolean;
  isDragActive: boolean;
  isSwapMode: boolean;
  revealed: boolean;
  dropKey: number;
  activeCourse: Course | null;
  viewDetailsLabel?: string;
  replaceLabel?: string;
  slotColors: string[];
  onSwapSlotClick?: () => void;
}) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const [expanded, setExpanded] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [popping, setPopping] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Color by slot position, not by course identity
  const resolved = getSlotColor(index, slotColors);
  const CourseIcon = course.icon ? getIcon(course.icon) : null;

  useEffect(() => {
    if (dropKey === 0) return;
    setPopping(true);
    const t = setTimeout(() => setPopping(false), 500);
    return () => clearTimeout(t);
  }, [dropKey]);

  useEffect(() => {
    setExpanded(false);
  }, [course.name]);

  const SEGMENT_MS = 320;
  const LINE_MS = 280;
  const stepDelay = index * SEGMENT_MS;
  const cardRevealDelay = index * SEGMENT_MS + 80;
  const outgoingLineDelay = index * SEGMENT_MS + 60;
  // Start incoming right when the previous card's outgoing finishes, so line flows top→bottom
  const incomingLineDelay = (index - 1) * SEGMENT_MS + 60 + LINE_MS;

  const [cardEntered, setCardEntered] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setCardEntered(true), cardRevealDelay + 450);
    return () => clearTimeout(t);
  }, [revealed, cardRevealDelay]);

  const { setNodeRef } = useDroppable({ id: `path-slot-${index}` });
  const mobileStepOffset = "1.875rem"; // mt-6 + top-3 + half step badge (6 + 12 + 12px)
  const showReplaceOverlay = isOver && isDragActive && !!activeCourse;
  const showSwapMask = isSwapMode && showReplaceOverlay;
  const showDragOverlay = showReplaceOverlay && !isSwapMode;
  const pathCardBackground = isOver
    ? isSwapMode
      ? `color-mix(in srgb, hsl(var(--background)) 95%, ${hslColor(resolved, 1)})`
      : hslColor(resolved, 0.05)
    : "hsl(var(--background))";
  const pathCardShadow = isOver && !isSwapMode
    ? "none"
    : hovered && !isSwapMode
      ? `0 3px 10px ${hslColor(resolved, 0.13)}, 0 8px 22px ${hslColor(resolved, 0.08)}`
      : "0 1px 4px rgba(0,0,0,0.09), 0 4px 14px rgba(0,0,0,0.07)";

  const pathCardMain = (
    <div className="flex flex-col gap-2 md:gap-3 px-3 pt-3 pb-2.5 md:px-[15px] md:pt-[14px] md:pb-[12px] md:flex-row md:items-start md:gap-[10px]">
      <div className="flex-1 min-w-0 w-full">
        <div className="flex items-start gap-[6px] mb-[4px] w-full pr-20 md:pr-0">
          <div className="shrink-0 scale-90 md:scale-100 origin-top-left">
            {CourseIcon ? <CourseIcon size={17} style={{ color: hslColor(resolved, 1) }} /> : <IconBookFilled size={17} style={{ color: hslColor(resolved, 1) }} />}
          </div>
          <div className="text-[14px] md:text-[16px] font-extrabold leading-[1.3] flex-1 min-w-0" style={{ color: "hsl(var(--foreground))" }}>
            {course.name}
          </div>
        </div>
        <div className="text-[12px] md:text-[14px] leading-[1.4] mb-[8px] w-full pr-20 md:pr-0 md:pl-[23px]" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
          {course.tagline}
        </div>
        <div className="flex items-center justify-between gap-2 w-[calc(100%+1.5rem)] -mx-3 px-3 md:mx-0 md:w-full md:px-0 md:pl-[23px] md:justify-start">
          <div className="flex flex-wrap items-center gap-[5px] min-w-0">
            {course.tools.slice(0, 4).map((tool, toolIdx) => (
              <span
                key={tool}
                className={`text-[9px] md:text-[10px] font-semibold px-[6px] md:px-[7px] py-[2px] rounded-full whitespace-nowrap ${toolIdx >= 3 ? "hidden md:inline-flex" : "inline-flex"}`}
                style={{
                  color: hslColor(resolved, 1),
                  background: hslColor(resolved, 0.1),
                  transition: "opacity 160ms ease 60ms, transform 200ms cubic-bezier(.4,0,.8,1) 0ms",
                  opacity: expanded ? 0 : 1,
                  transform: expanded ? "translateY(145px) scale(0.6)" : "translateY(0) scale(1)",
                }}
              >
                {tool}
              </span>
            ))}
          </div>
          {viewDetailsLabel && (
          <div
            className="md:hidden inline-flex items-center gap-[5px] text-[11px] font-semibold px-[9px] py-[4px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap flex-shrink-0"
            style={{
              color: hslColor(resolved, 1),
              background: "transparent",
              border: `1.5px solid ${hslColor(resolved, 0.45)}`,
              transform: btnHovered ? "scale(1.04)" : "scale(1)",
            }}
            onClick={(e) => { e.stopPropagation(); if (!showSwapMask) setExpanded((x) => !x); }}
            onMouseEnter={() => setBtnHovered(true)}
            onMouseLeave={() => setBtnHovered(false)}
          >
            {viewDetailsLabel}
            <span
              className="text-[12px] leading-none transition-transform duration-200"
              style={{ display: "inline-block", transform: expanded ? "rotate(180deg)" : "none" }}
            >
              ▾
            </span>
          </div>
          )}
        </div>
      </div>

      <div className="hidden md:flex md:flex-col md:items-end md:justify-between md:w-auto flex-shrink-0 md:self-stretch">
        <div
          className="text-[9px] px-[6px] py-[2px] rounded-full font-semibold whitespace-nowrap"
          style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.12) }}
        >
          {course.hrs}
        </div>
        {viewDetailsLabel && (
        <div
          className="inline-flex items-center gap-[5px] text-[12px] font-semibold px-[11px] py-[5px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap"
          style={{
            color: hslColor(resolved, 1),
            background: "transparent",
            border: `1.5px solid ${hslColor(resolved, 0.45)}`,
            transform: btnHovered ? "scale(1.04)" : "scale(1)",
          }}
          onClick={(e) => { e.stopPropagation(); if (!showSwapMask) setExpanded((x) => !x); }}
          onMouseEnter={() => setBtnHovered(true)}
          onMouseLeave={() => setBtnHovered(false)}
        >
          {viewDetailsLabel}
          <span
            className="text-[13px] leading-none transition-transform duration-200"
            style={{ display: "inline-block", transform: expanded ? "rotate(180deg)" : "none" }}
          >
            ▾
          </span>
        </div>
        )}
      </div>
    </div>
  );

  return (
    <div ref={setNodeRef} className="relative">
      {/* Mobile timeline — connector line only, aligned with step badge */}
      {!isFirst && (
        <div
          className="md:hidden absolute z-0 right-6 top-0 w-[2px] -translate-x-1/2 overflow-hidden"
          style={{ height: mobileStepOffset }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "hsl(var(--primary))",
              opacity: expanded ? 0 : 0.25,
              transformOrigin: "top",
              transform: revealed ? "scaleY(1)" : "scaleY(0)",
              transition: expanded
                ? `opacity 0ms 300ms, transform ${LINE_MS}ms cubic-bezier(.4,0,.2,1) ${incomingLineDelay}ms`
                : `transform ${LINE_MS}ms cubic-bezier(.4,0,.2,1) ${incomingLineDelay}ms`,
            }}
          />
        </div>
      )}
      {!isLast && (
        <div
          className="md:hidden absolute z-0 right-6 w-[2px] -translate-x-1/2 overflow-hidden"
          style={{ top: mobileStepOffset, bottom: 0 }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "hsl(var(--primary))",
              opacity: 0.25,
              transformOrigin: "top",
              transform: revealed ? "scaleY(1)" : "scaleY(0)",
              transition: `transform ${LINE_MS}ms cubic-bezier(.4,0,.2,1) ${outgoingLineDelay}ms`,
            }}
          />
        </div>
      )}

      <div className="relative flex md:flex-row md:gap-5 md:items-center">
      {!isFirst && (
        <div className="hidden md:block absolute z-0 overflow-hidden" style={{
          left: 15, top: 0, bottom: "50%", width: 2,
          background: "transparent",
        }}>
          <div style={{
            width: "100%", height: "100%",
            background: "hsl(var(--primary))",
            opacity: 0.25,
            transformOrigin: "top",
            transform: revealed ? "scaleY(1)" : "scaleY(0)",
            transition: `transform ${LINE_MS}ms cubic-bezier(.4,0,.2,1) ${incomingLineDelay}ms`,
          }} />
        </div>
      )}
      {!isLast && (
        <div className="hidden md:block absolute z-0" style={{ left: 15, top: "50%", bottom: 0, width: 2, overflow: "hidden" }}>
          <div style={{
            width: "100%", height: "100%",
            background: "hsl(var(--primary))", opacity: 0.25,
            transformOrigin: "top",
            transform: revealed ? "scaleY(1)" : "scaleY(0)",
            transition: `transform ${LINE_MS}ms cubic-bezier(.4,0,.2,1) ${outgoingLineDelay}ms`,
          }} />
        </div>
      )}

      <div className="hidden md:flex flex-shrink-0 z-10 items-center justify-center" style={{ width: 32 }}>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold"
          style={{
            background: "hsl(var(--primary))",
            color: "hsl(var(--primary-foreground))",
            transform: revealed ? "scale(1)" : "scale(0)",
            transition: `transform 300ms cubic-bezier(.34,1.56,.64,1) ${stepDelay}ms`,
          }}
        >
          {index + 1}
        </div>
      </div>

      <style>{`
        @keyframes path-card-pop { 0%{transform:translateX(0) scale(1)} 40%{transform:translateX(0) scale(1.018)} 100%{transform:translateX(0) scale(1)} }
        @keyframes path-card-reveal { 0%{opacity:0;transform:translateY(14px) scale(0.97)} 100%{opacity:1;transform:translateY(0) scale(1)} }
      `}</style>
      <div
        className="relative z-10 flex-1 w-full my-[4px] md:my-[6px] rounded-[13px]"
        style={{
          background: pathCardBackground,
          border: isOver ? `2px dashed ${hslColor(resolved, 0.55)}` : "2px solid transparent",
          boxShadow: pathCardShadow,
          opacity: !revealed ? 0 : cardEntered ? 1 : undefined,
          transform: cardEntered ? (hovered && !isSwapMode ? "translateY(-2px)" : "none") : undefined,
          transition: cardEntered ? "transform 180ms ease, box-shadow 200ms" : undefined,
          animation: popping
            ? "path-card-pop 0.45s cubic-bezier(.34,1.56,.64,1)"
            : revealed && !cardEntered
              ? `path-card-reveal 420ms cubic-bezier(.4,0,.2,1) ${cardRevealDelay}ms both`
              : undefined,
          cursor: isSwapMode ? "pointer" : undefined,
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={isSwapMode && onSwapSlotClick ? onSwapSlotClick : undefined}
      >
        {!showSwapMask && (
        <div className="md:hidden absolute top-3 right-3 z-20 flex items-center gap-[6px]">
          <span
            className="text-[10px] font-semibold whitespace-nowrap"
            style={{
              color: hslColor(resolved, 1),
              opacity: revealed ? 1 : 0,
              transform: revealed ? "translateX(0)" : "translateX(6px)",
              transition: `opacity 220ms ease ${stepDelay + 50}ms, transform 260ms ease ${stepDelay + 50}ms`,
            }}
          >
            {course.hrs}
          </span>
          <div
            className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold"
            style={{
              background: "hsl(var(--primary))",
              color: "hsl(var(--primary-foreground))",
              transform: revealed ? "scale(1)" : "scale(0)",
              transition: `transform 300ms cubic-bezier(.34,1.56,.64,1) ${stepDelay}ms`,
            }}
          >
            {index + 1}
          </div>
        </div>
        )}
        {showDragOverlay ? (
          <div className="relative">
            <div style={{ opacity: 0, pointerEvents: "none", userSelect: "none" }}>
              <div className="flex flex-col gap-2 md:gap-3 px-3 pt-3 pb-2.5 md:px-[15px] md:pt-[14px] md:pb-[12px] md:flex-row md:items-start md:gap-[10px]">
                <div className="flex-1 min-w-0 w-full">
                  <div className="flex items-start gap-[6px] mb-[4px] w-full pr-20 md:pr-0">
                    <div className="shrink-0 scale-90 md:scale-100 origin-top-left">
                      {CourseIcon ? <CourseIcon size={17} style={{ color: hslColor(resolved, 1) }} /> : <IconBookFilled size={17} style={{ color: hslColor(resolved, 1) }} />}
                    </div>
                    <div className="text-[14px] md:text-[16px] font-extrabold leading-[1.3] flex-1 min-w-0" style={{ color: "hsl(var(--foreground))" }}>{course.name}</div>
                  </div>
                  <div className="text-[12px] md:text-[13px] leading-[1.4] mb-[8px] w-full pr-20 md:pr-0 md:pl-[23px]" style={{ color: "hsl(var(--muted-foreground))" }}>{course.tagline}</div>
                  <div className="flex flex-wrap items-center gap-[5px] w-full md:pl-[23px]">
                    {course.tools.slice(0, 4).map((t, toolIdx) => (
                      <span key={t} className={`text-[9px] md:text-[10px] font-semibold px-[6px] md:px-[7px] py-[2px] rounded-full ${toolIdx >= 3 ? "hidden md:inline-flex" : "inline-flex"}`} style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.1) }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div className="hidden md:flex md:flex-col md:items-end md:w-auto flex-shrink-0 md:self-stretch">
                  <div className="text-[9px] px-[6px] py-[2px] rounded-full font-semibold" style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.12) }}>{course.hrs}</div>
                </div>
              </div>
            </div>
            <div
              className="absolute inset-0 z-10 flex items-start px-3 pt-3 md:px-0 md:pl-[38px] md:pt-[14px] rounded-[13px]"
            >
              {replaceLabel && activeCourse && (
              <div className="text-[14px] md:text-[16px] font-extrabold leading-[1.3]" style={{ color: hslColor(resolved, 1) }}>
                {replaceLabel} {activeCourse.name}
              </div>
              )}
            </div>
          </div>
        ) : (
          <div className="relative">
            <div className={showSwapMask ? "pointer-events-none select-none" : undefined}>
              {pathCardMain}
            </div>
            {showSwapMask && activeCourse && (
              <div
                className="absolute inset-0 z-10 flex items-center justify-center text-center px-4 rounded-[13px]"
                style={{ background: pathCardBackground }}
              >
                {replaceLabel && (
                <div className="text-[14px] md:text-[16px] font-extrabold leading-[1.3]" style={{ color: hslColor(resolved, 1) }}>
                  {replaceLabel} {activeCourse.name}
                </div>
                )}
              </div>
            )}
          </div>
        )}

        {!showSwapMask && viewDetailsLabel && (
        <div
          className="overflow-hidden transition-all duration-300"
          style={{
            maxHeight: expanded ? 300 : 0,
            borderTop: `1px solid ${hslColor(resolved, expanded ? 0.15 : 0)}`,
          }}
        >
          <div className="px-[13px] pt-[10px] pb-[10px] flex flex-col gap-2">
            {course.skills.map((s) => (
              <SkillBar key={s.name} name={s.name} skill_percentage={s.skill_percentage} animate={expanded} resolved={resolved} />
            ))}
          </div>
          {course.tools.length > 0 && (
            <CourseToolsMarquee tools={course.tools} resolved={resolved} />
          )}
        </div>
        )}
      </div>
      </div>
    </div>
  );
}

function DraggableCardTextContent({
  course,
  courseIcon,
  titleStyle,
  taglineStyle,
  hrsStyle,
  titleClassName = "text-[15px] font-bold leading-[1.3]",
  alignTaglineWithTitle = false,
}: {
  course: Course;
  courseIcon: ReactNode;
  titleStyle?: React.CSSProperties;
  taglineStyle?: React.CSSProperties;
  hrsStyle?: React.CSSProperties;
  titleClassName?: string;
  alignTaglineWithTitle?: boolean;
}) {
  return (
    <div className="flex flex-col gap-[2px] flex-1 min-w-0">
      <div className="flex items-stretch w-full">
        <div className="flex-1 min-w-0">
          <div className="overflow-hidden">
            <div className="float-left mr-[7px] mt-[2px]">{courseIcon}</div>
            <div className={titleClassName} style={titleStyle}>
              {course.name}
            </div>
          </div>
        </div>
        <div className="flex items-start shrink-0 self-start pl-[2px]">
          <div
            className="text-[10px] px-[7px] py-[2px] rounded-full font-semibold whitespace-nowrap"
            style={hrsStyle}
          >
            {course.hrs}
          </div>
        </div>
      </div>
      <div
        className="text-[12px] leading-[1.4] w-full"
        style={{ ...taglineStyle, paddingLeft: alignTaglineWithTitle ? "21px" : undefined }}
      >
        {course.tagline}
      </div>
    </div>
  );
}

// Available course card — neutral by default, primary blue on hover
function DraggableCourseCard({
  course,
  viewDetailsLabel,
  swapLabel,
  swapIcon,
  swapPromptLabel,
  swapCancelLabel,
  isSwapSource,
  onSwapClick,
  isDraggable = true,
}: {
  course: Course;
  viewDetailsLabel?: string;
  swapLabel?: string;
  swapIcon?: string;
  swapPromptLabel?: string;
  swapCancelLabel?: string;
  isSwapSource: boolean;
  onSwapClick: () => void;
  isDraggable?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [swapBtnHovered, setSwapBtnHovered] = useState(false);
  const [hovered, setHovered] = useState(false);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `draggable-${course.name}`,
    data: { courseName: course.name },
  });

  const dndTranslate = CSS.Translate.toString(transform) ?? "";
  const hoverLift = hovered && !isDragging ? "translateY(-2px)" : "";
  const outerTransform = [dndTranslate, hoverLift].filter(Boolean).join(" ") || undefined;

  const CourseIcon = course.icon ? getIcon(course.icon) : null;
  const SwapIcon = (swapIcon ? getIcon(swapIcon) : null) ?? IconArrowsExchange;

  const expandedSection = (absolute?: boolean) => (
    <div
      className={
        absolute
          ? "absolute left-0 right-0 top-full z-10 overflow-hidden transition-all duration-300 rounded-b-[13px]"
          : "overflow-hidden transition-all duration-300"
      }
      style={{
        maxHeight: expanded && !isSwapSource ? 260 : 0,
        borderTop: absolute ? "none" : `1px solid hsl(var(--primary) / ${expanded && !isSwapSource ? 0.15 : 0})`,
        ...(absolute && expanded && !isSwapSource
          ? {
              borderWidth: "0 1.5px 1.5px",
              borderStyle: "solid",
              borderColor: hovered ? "hsl(var(--primary) / 0.55)" : "hsl(var(--border))",
              background: "hsl(var(--background))",
              boxShadow: "0 8px 22px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
            }
          : {}),
      }}
      onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
    >
      <div className="px-[13px] pt-[10px] pb-[10px] flex flex-col gap-2">
        {course.skills.map((s) => (
          <SkillBar key={s.name} name={s.name} skill_percentage={s.skill_percentage} animate={expanded} resolved={PRIMARY_RESOLVED} />
        ))}
      </div>
      {course.tools.length > 0 && (
        <CourseToolsMarquee tools={course.tools} resolved={PRIMARY_RESOLVED} />
      )}
    </div>
  );

  const mobileCardMain = (
    <div className="flex flex-col">
      <div className="flex items-stretch">
        <div className="flex-1 min-w-0 px-[13px] pt-[13px] pb-0">
          <div className="flex items-start gap-[7px]">
            {CourseIcon ? <CourseIcon size={14} style={{ color: hovered ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.45)", transition: "color .2s", flexShrink: 0, marginTop: 2 }} /> : <IconBookFilled size={14} style={{ color: hovered ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.45)", transition: "color .2s", flexShrink: 0, marginTop: 2 }} />}
            <div
              className="text-[13.5px] font-bold leading-[1.3] flex-1 min-w-0"
              style={{ color: hovered ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.75)", transition: "color .2s" }}
            >
              {course.name}
            </div>
          </div>
        </div>
        <div className="flex items-start flex-shrink-0 pt-[13px] pr-[13px]">
          <div
            className="text-[10px] px-[7px] py-[2px] rounded-full font-semibold whitespace-nowrap"
            style={{
              color: hovered ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.5)",
              background: hovered ? "hsl(var(--primary) / 0.1)" : "hsl(var(--muted-foreground) / 0.07)",
              transition: "color .2s, background .2s",
            }}
          >
            {course.hrs}
          </div>
        </div>
      </div>
      <div className="text-[12px] leading-[1.4] w-full px-[13px] pb-[7px]" style={{ color: "hsl(var(--muted-foreground))" }}>
        {course.tagline}
      </div>
      <div className="flex items-end justify-between gap-2 px-[13px] pb-[10px]">
        {viewDetailsLabel && (
        <div
          className="flex items-center gap-[4px] cursor-pointer origin-left"
          style={{ transform: btnHovered ? "scale(1.06)" : "scale(1)", transition: "transform 150ms ease" }}
          onClick={(e) => { e.stopPropagation(); if (!isSwapSource) setExpanded((x) => !x); }}
          onMouseEnter={() => setBtnHovered(true)}
          onMouseLeave={() => setBtnHovered(false)}
        >
          <span
            className="text-[11px] font-bold tracking-[0.07em] uppercase"
            style={{ color: "hsl(var(--primary))", transition: "color .2s" }}
          >
            {viewDetailsLabel}
          </span>
          <span
            className="text-[18px] leading-none"
            style={{
              color: "hsl(var(--primary))",
              transform: expanded ? "rotate(180deg)" : "none",
              display: "inline-block",
              transition: "color .2s, transform .2s",
            }}
          >
            ▾
          </span>
        </div>
        )}
        {swapLabel && (
        <div
          className={`inline-flex items-center gap-[5px] text-[11px] font-semibold px-[9px] py-[3px] rounded-[8px] cursor-pointer select-none transition-all duration-150 whitespace-nowrap flex-shrink-0 ${viewDetailsLabel ? "" : "ml-auto"}`}
          style={{
            color: "hsl(var(--primary))",
            background: "transparent",
            border: "1.5px solid hsl(var(--primary) / 0.45)",
            transform: swapBtnHovered ? "scale(1.04)" : "scale(1)",
          }}
          onClick={(e) => { e.stopPropagation(); if (!isSwapSource) onSwapClick(); }}
          onMouseEnter={() => setSwapBtnHovered(true)}
          onMouseLeave={() => setSwapBtnHovered(false)}
        >
          {SwapIcon && <SwapIcon size={14} style={{ flexShrink: 0 }} />}
          {swapLabel}
        </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: outerTransform,
        transition: isDragging ? "none" : "transform .18s",
      }}
      className="select-none h-full"
    >
      {/* Desktop — production layout */}
      <div
        className="hidden md:block h-full"
        style={{
          touchAction: isDraggable ? "none" : undefined,
          cursor: isDraggable ? (isDragging ? "grabbing" : "grab") : "default",
        }}
        {...(isDraggable ? listeners : {})}
        {...(isDraggable ? attributes : {})}
      >
        <div
          style={{
            borderColor: hovered ? "hsl(var(--primary) / 0.55)" : "hsl(var(--border))",
            background: "hsl(var(--background))",
            opacity: isDragging ? 0 : hovered ? 1 : 0.6,
            boxShadow: hovered && !isDragging
              ? "0 3px 10px hsl(var(--primary) / 0.1), 0 8px 22px hsl(var(--primary) / 0.07)"
              : "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)",
            transition: "border-color .2s, box-shadow .2s, opacity .2s",
          }}
          className="rounded-[13px] border-[1.5px] flex flex-col relative"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className="flex flex-col flex-1 min-h-0">
            <div className="flex items-start gap-[3px] p-[13px] pb-[6px]">
              {isDraggable && <GripVertical size={31} className="mt-1 shrink-0" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }} />}
              <DraggableCardTextContent
                course={course}
                courseIcon={
                  CourseIcon ? (
                    <CourseIcon size={14} style={{ color: hovered ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.45)", transition: "color .2s" }} />
                  ) : (
                    <IconBookFilled size={14} style={{ color: hovered ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.45)", transition: "color .2s" }} />
                  )
                }
                titleStyle={{ color: hovered ? "hsl(var(--primary))" : "hsl(var(--foreground) / 0.75)", transition: "color .2s" }}
                taglineStyle={{ color: "hsl(var(--muted-foreground))" }}
                hrsStyle={{
                  color: hovered ? "hsl(var(--primary))" : "hsl(var(--muted-foreground) / 0.5)",
                  background: hovered ? "hsl(var(--primary) / 0.1)" : "hsl(var(--muted-foreground) / 0.07)",
                  transition: "color .2s, background .2s",
                }}
                alignTaglineWithTitle={!isDraggable}
              />
            </div>
            <div className="flex-1 min-h-0" aria-hidden />
            {viewDetailsLabel && (
            <div
              className="flex items-center gap-[4px] px-[13px] pb-[10px] pt-[10px] cursor-pointer origin-left"
              style={{ transform: btnHovered ? "scale(1.06)" : "scale(1)", transition: "transform 150ms ease" }}
              onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
              onMouseEnter={() => setBtnHovered(true)}
              onMouseLeave={() => setBtnHovered(false)}
            >
              <span
                className="text-[11px] font-bold tracking-[0.07em] uppercase"
                style={{ color: "hsl(var(--primary))", transition: "color .2s" }}
              >
                {viewDetailsLabel}
              </span>
              <span
                className="text-[18px] leading-none"
                style={{
                  color: "hsl(var(--primary))",
                  transform: expanded ? "rotate(180deg)" : "none",
                  display: "inline-block",
                  transition: "color .2s, transform .2s",
                }}
              >
                ▾
              </span>
            </div>
            )}
          </div>
          {viewDetailsLabel && expandedSection()}
        </div>
      </div>

      {/* Mobile — swap flow + compact layout */}
      <div className="md:hidden">
        <div
          style={{
            borderColor: isSwapSource ? "hsl(var(--primary) / 0.55)" : hovered ? "hsl(var(--primary) / 0.55)" : "hsl(var(--border))",
            background: isSwapSource ? "hsl(var(--muted))" : "hsl(var(--background))",
            opacity: isDragging ? 0 : 1,
            boxShadow: hovered && !isDragging && !isSwapSource
              ? "0 3px 10px hsl(var(--primary) / 0.1), 0 8px 22px hsl(var(--primary) / 0.07)"
              : "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)",
            transition: "border-color .2s, box-shadow .2s, opacity .2s, background .2s",
            borderStyle: isSwapSource ? "dashed" : "solid",
          }}
          className="relative rounded-[13px] border-[1.5px]"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <div className={isSwapSource ? "pointer-events-none select-none invisible" : undefined}>
            {mobileCardMain}
            {!isSwapSource && viewDetailsLabel && expandedSection()}
          </div>
          {isSwapSource && (
            <div
              className="absolute inset-0 flex flex-col items-center justify-center text-center px-4 rounded-[13px] cursor-pointer"
              style={{ background: "hsl(var(--muted))" }}
              onClick={() => onSwapClick()}
            >
              {swapPromptLabel && (
                <div className="text-[14px] font-extrabold leading-[1.35]" style={{ color: "hsl(var(--primary))" }}>
                  {swapPromptLabel}
                </div>
              )}
              {swapCancelLabel && (
                <span
                  className={`text-[12px] font-semibold ${swapPromptLabel ? "mt-3" : ""}`}
                  style={{ color: "hsl(var(--muted-foreground) / 0.65)" }}
                >
                  {swapCancelLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// DragOverlay — primary by default, switches to target slot color when hovering a slot
function DragOverlayCard({
  course,
  overSlotColor,
  viewDetailsLabel,
}: {
  course: Course;
  overSlotColor: ResolvedColor | null;
  viewDetailsLabel?: string;
}) {
  const resolved = overSlotColor ?? PRIMARY_RESOLVED;
  return (
    <div
      style={{
        borderColor: hslColor(resolved, 0.55),
        background: "hsl(var(--background))",
        boxShadow: `0 20px 48px rgba(0,0,0,0.22), 0 6px 16px rgba(0,0,0,0.14), 0 0 0 1px ${hslColor(resolved, 0.12)}`,
        cursor: "grabbing",
      }}
      className="rounded-[13px] border-[1.5px] select-none"
    >
      <div className="flex items-stretch">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-start gap-[10px] p-[13px] pb-[6px]">
            <GripVertical size={34} className="shrink-0" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }} />
            <DraggableCardTextContent
              course={course}
              courseIcon={(() => {
                const CI = course.icon ? getIcon(course.icon) : null;
                return CI ? (
                  <CI size={14} style={{ color: hslColor(resolved, 1) }} />
                ) : (
                  <IconBookFilled size={14} style={{ color: hslColor(resolved, 1) }} />
                );
              })()}
              titleStyle={{ color: hslColor(resolved, 1) }}
              taglineStyle={{ color: "hsl(var(--muted-foreground) / 0.4)" }}
              hrsStyle={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.1) }}
            />
          </div>
          {viewDetailsLabel && (
          <div className="flex items-center gap-[4px] px-[13px] pb-[10px] pt-[10px]">
            <span className="text-[11px] font-bold tracking-[0.07em] uppercase" style={{ color: hslColor(resolved, 1) }}>
              {viewDetailsLabel}
            </span>
            <span className="text-[18px] leading-none" style={{ color: hslColor(resolved, 1) }}>▾</span>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Ghost shown in available grid when dragging a course over a path slot
function GhostPreviewCard({ course, slotIndex, slotColors }: { course: Course; slotIndex: number; slotColors: string[] }) {
  const resolved = getSlotColor(slotIndex, slotColors);
  return (
    <div
      className="rounded-[13px] border-[1.5px] h-full"
      style={{
        borderColor: hslColor(resolved, 0.35),
        borderStyle: "dashed",
        background: hslColor(resolved, 0.04),
        opacity: 0.75,
      }}
    >
      <div className="flex items-stretch h-full">
        <div className="flex-1 min-w-0 flex flex-col h-full">
          <div className="flex items-start gap-[10px] p-[13px] pb-[6px]">
            <GripVertical size={34} className="shrink-0" style={{ color: "hsl(var(--muted-foreground) / 0.25)" }} />
            <DraggableCardTextContent
              course={course}
              courseIcon={<IconBookFilled size={14} style={{ color: hslColor(resolved, 0.7) }} />}
              titleStyle={{ color: hslColor(resolved, 0.8) }}
              taglineStyle={{ color: "hsl(var(--muted-foreground) / 0.35)" }}
              hrsStyle={{ color: hslColor(resolved, 0.7), background: hslColor(resolved, 0.08) }}
            />
          </div>
          <div className="flex-1 min-h-0" aria-hidden />
          <div className="flex items-center gap-[4px] px-[13px] pb-[10px] pt-[10px]">
            <span className="text-[11px] font-bold tracking-[0.07em] uppercase" style={{ color: hslColor(resolved, 0.55) }}>
              ↑ goes here
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function AvailableDropZone({ children, isDragActive }: { children: React.ReactNode; isDragActive: boolean }) {
  return (
    <div>
      {children}
      {isDragActive && (
        <div
          className="mt-2 rounded-[13px] border-[1.5px] flex items-center justify-center py-[10px] text-[11px] font-bold tracking-[0.07em] uppercase"
          style={{
            borderStyle: "dashed",
            borderColor: "hsl(var(--border))",
            color: "hsl(var(--muted-foreground) / 0.35)",
            background: "transparent",
          }}
        >
          Drop here to cancel
        </div>
      )}
    </div>
  );
}

export default function AiFlexPathCourseColorSelector({ data }: { data: AiFlexPathCourseColorSelector }) {
  const [pathCourseNames, setPathCourseNames] = useState<string[]>(data.default_courses);
  const [activeCourseName, setActiveCourseName] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const [counterFlash, setCounterFlash] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [dropCounts, setDropCounts] = useState<number[]>([0, 0, 0, 0, 0]);
  const [swapCandidate, setSwapCandidate] = useState<string | null>(null);
  const lastOverSlotRef = useRef<number | null>(null);
  const [activeDeltaY, setActiveDeltaY] = useState(0);
  const nav = useInternalNav();

  const slotColors = data.slot_colors?.length
    ? data.slot_colors.map((s) => s.color)
    : DEFAULT_COURSE_COLORS;
  const isDraggable = data.draggable !== false;
  const showAvailableCourses = data.show_available_courses !== false;
  const viewDetailsLabel = data.view_details_label;
  const replaceLabel = data.replace_label;
  const dragInstructionLabel = data.drag_instruction_label;
  const swapLabel = data.swap_label;
  const swapIcon = data.swap_icon;
  const swapPromptLabel = data.swap_prompt_label;
  const swapCancelLabel = data.swap_cancel_label;
  const swapModeActive = !!swapCandidate;
  const swapCourse = swapCandidate ? data.courses.find((c) => c.name === swapCandidate) ?? null : null;

  useEffect(() => {
    const t = setTimeout(() => setRevealed(true), 60);
    return () => clearTimeout(t);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const pathCourses = pathCourseNames
    .map((n) => data.courses.find((c) => c.name === n)!)
    .filter(Boolean);
  const availableCourses = data.courses.filter((c) => !pathCourseNames.includes(c.name));
  const activeCourse = activeCourseName ? data.courses.find((c) => c.name === activeCourseName) ?? null : null;

  const pathTools = useMemo(() => {
    const seen = new Set<string>();
    const tools: string[] = [];
    pathCourseNames.forEach((cName) => {
      data.courses.find((c) => c.name === cName)?.tools.forEach((t) => {
        if (!seen.has(t)) { seen.add(t); tools.push(t); }
      });
    });
    return tools;
  }, [pathCourseNames, data.courses]);

  function swapCourseIntoSlot(courseName: string, slotIndex: number) {
    setPathCourseNames((prev) => {
      const next = [...prev];
      next[slotIndex] = courseName;
      return next;
    });
    setDropCounts((prev) => {
      const next = [...prev];
      next[slotIndex] = (next[slotIndex] || 0) + 1;
      return next;
    });
    setCounterFlash(true);
    setTimeout(() => setCounterFlash(false), 400);
    setSwapCandidate(null);
  }

  function handleSwapClick(courseName: string) {
    setActiveCourseName(null);
    setOverSlot(null);
    setActiveDeltaY(0);
    setSwapCandidate((prev) => (prev === courseName ? null : courseName));
  }

  function handleDragStart(event: DragStartEvent) {
    const courseName = (event.active.id as string).replace("draggable-", "");
    setActiveCourseName(courseName || null);
    setActiveDeltaY(0);
    lastOverSlotRef.current = null;
  }

  function handleDragMove(event: DragMoveEvent) {
    setActiveDeltaY(event.delta.y);
  }

  function handleDragOver(event: { over?: { id: string } | null }) {
    const overId = event.over?.id as string | undefined;
    if (overId?.startsWith("path-slot-")) {
      const slot = parseInt(overId.replace("path-slot-", ""));
      setOverSlot(slot);
      lastOverSlotRef.current = slot;
    } else {
      setOverSlot(null);
      lastOverSlotRef.current = null;
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { over, active } = event;
    const draggedName = (active.id as string).replace("draggable-", "");
    let slotIndex: number | null = null;
    const overId = over?.id ? String(over.id) : null;
    if (overId?.startsWith("path-slot-")) {
      slotIndex = parseInt(overId.replace("path-slot-", ""));
    } else if (lastOverSlotRef.current !== null) {
      slotIndex = lastOverSlotRef.current;
    }

    setActiveCourseName(null);
    setOverSlot(null);
    setActiveDeltaY(0);
    lastOverSlotRef.current = null;

    if (slotIndex === null || !draggedName) return;

    swapCourseIntoSlot(draggedName, slotIndex);
  }

  const toolBadgeClassName =
    "inline-block font-semibold whitespace-nowrap flex-shrink-0 mr-[5px] md:mr-[7px] rounded-full bg-white text-[10px] md:text-[15px] px-[8px] py-[3px] md:px-[15px] md:py-[7px]";
  const toolBadgeStyle: React.CSSProperties = {
    fontFamily: "'SF Mono','Fira Code',monospace",
    fontWeight: 600,
    color: "hsl(var(--muted-foreground))",
  };

  const maskStyle: React.CSSProperties = {
    WebkitMaskImage: "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
    maskImage: "linear-gradient(to right, transparent 0%, black 8%, black 92%, transparent 100%)",
  };

  const useTwoRows = pathTools.length > 8;
  const mid = Math.ceil(pathTools.length / 2);
  const row1 = useTwoRows ? pathTools.slice(0, mid) : pathTools;
  const row2 = useTwoRows ? pathTools.slice(mid) : [];

  const totalHrs = pathCourses.reduce((sum, c) => {
    const n = parseFloat(c.hrs.replace("~", "").replace(" hrs", ""));
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  const SectionIcon = data.icon ? getIcon(data.icon) : null;

  function renderSectionMedia(size: "sm" | "lg") {
    if (data.image_id) {
      const px = size === "sm" ? 40 : 40;
      return (
        <UniversalImage
          id={data.image_id}
          style={{ objectFit: "contain", width: `${px}px`, height: `${px}px` }}
        />
      );
    }
    if (SectionIcon) {
      const px = size === "sm" ? "28" : "55";
      return (
        <SectionIcon width={px} height={px} style={{ color: "hsl(var(--foreground))" }} />
      );
    }
    return null;
  }

  const hasSectionMedia = Boolean(data.image_id || SectionIcon);

  // Overlay color: slot color when hovering a slot, else null (uses primary)
  const overlaySlotColor = overSlot !== null ? getSlotColor(overSlot, slotColors) : null;

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
              <div className="text-[11px] md:text-[11px] font-bold tracking-[0.09em] uppercase mb-1 md:mb-0" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
                {data.ready_label}
              </div>
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

          {/* <div className="md:hidden mb-1 mt-1">
            <div
              className="text-[10px] font-bold tracking-[0.09em] uppercase text- w-full"
              style={{ color: "hsl(var(--muted-foreground) / 0.7)" }}
            >
              {data.results_subtitle}
            </div>
          </div> */}

          <div className="hidden md:flex items-center justify-between mb-4">
            <div className="text-[10px] md:text-[11px] font-bold tracking-[0.09em] uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
              {data.results_subtitle}
            </div>
            <div className="flex items-center gap-[8px]">
              <div className="text-[12px]" style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
                {totalHrs} hrs
              </div>
              <div
                className="text-[11px] font-bold px-[10px] py-[3px] rounded-full border transition-all duration-300"
                style={{
                  color: counterFlash ? "hsl(var(--destructive))" : "hsl(var(--primary))",
                  background: counterFlash ? "hsl(var(--destructive) / 0.08)" : "hsl(var(--primary) / 0.08)",
                  borderColor: counterFlash ? "hsl(var(--destructive) / 0.35)" : "hsl(var(--primary) / 0.25)",
                }}
              >
                {pathCourses.length} courses
              </div>
            </div>
          </div>

          <DndContext
            sensors={sensors}
            collisionDetection={pointerWithin}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <div className="mb-3">
              <div className="relative">
                <div className="flex flex-col">
                  {pathCourses.map((course, i) => (
                    <PathItem
                      key={`path-slot-${i}`}
                      course={course}
                      index={i}
                      total={pathCourses.length}
                      isOver={swapModeActive || (overSlot === i && !!activeCourseName && activeDeltaY < -40)}
                      isDragActive={!!activeCourseName || swapModeActive}
                      isSwapMode={swapModeActive}
                      revealed={revealed}
                      dropKey={dropCounts[i] ?? 0}
                      activeCourse={swapModeActive ? swapCourse : activeCourse}
                      viewDetailsLabel={viewDetailsLabel}
                      replaceLabel={replaceLabel}
                      slotColors={slotColors}
                      onSwapSlotClick={swapModeActive && swapCandidate ? () => swapCourseIntoSlot(swapCandidate, i) : undefined}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="md:hidden flex items-center justify-end gap-[8px] mb-4">
              <div className="text-[12px]" style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
                {totalHrs} hrs
              </div>
              <div
                className="text-[11px] font-bold px-[10px] py-[3px] rounded-full border transition-all duration-300"
                style={{
                  color: counterFlash ? "hsl(var(--destructive))" : "hsl(var(--primary))",
                  background: counterFlash ? "hsl(var(--destructive) / 0.08)" : "hsl(var(--primary) / 0.08)",
                  borderColor: counterFlash ? "hsl(var(--destructive) / 0.35)" : "hsl(var(--primary) / 0.25)",
                }}
              >
                {pathCourses.length} courses
              </div>
            </div>

            {showAvailableCourses && availableCourses.length > 0 && (
              <div>
                {dragInstructionLabel && (
                <div className="text-[11px] font-bold tracking-[0.09em] uppercase mb-4 md:hidden" style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
                  {dragInstructionLabel}
                </div>
                )}
                {dragInstructionLabel && (
                <div className="hidden md:block text-[11px] font-bold tracking-[0.09em] uppercase mb-4" style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
                  {dragInstructionLabel}
                </div>
                )}
                <AvailableDropZone isDragActive={!!activeCourseName}>
                  {/* Mobile: single column */}
                  <div className="md:hidden flex flex-col gap-[9px]">
                    {availableCourses.map((course) => {
                      const isBeingDragged = course.name === activeCourseName;
                      const displacedCourse = overSlot !== null && activeDeltaY < -40 ? pathCourses[overSlot] ?? null : null;
                      if (isBeingDragged && displacedCourse) {
                        return <GhostPreviewCard key={course.name} course={displacedCourse} slotIndex={overSlot!} slotColors={slotColors} />;
                      }
                      return (
                        <DraggableCourseCard key={course.name} course={course} viewDetailsLabel={viewDetailsLabel} swapLabel={swapLabel} swapIcon={swapIcon} swapPromptLabel={swapPromptLabel} swapCancelLabel={swapCancelLabel} isSwapSource={swapCandidate === course.name} onSwapClick={() => handleSwapClick(course.name)} isDraggable={isDraggable} />
                      );
                    })}
                  </div>
                  {/* Desktop: two independent flex columns so expansion only pushes its own column */}
                  <div className="hidden md:flex gap-[9px] items-start">
                    {[0, 1].map((colIdx) => (
                      <div key={colIdx} className="flex flex-col gap-[9px] flex-1 min-w-0">
                        {availableCourses.filter((_, i) => i % 2 === colIdx).map((course) => {
                          const isBeingDragged = course.name === activeCourseName;
                          const displacedCourse = overSlot !== null && activeDeltaY < -40 ? pathCourses[overSlot] ?? null : null;
                          if (isBeingDragged && displacedCourse) {
                            return <GhostPreviewCard key={course.name} course={displacedCourse} slotIndex={overSlot!} slotColors={slotColors} />;
                          }
                          return (
                            <DraggableCourseCard key={course.name} course={course} viewDetailsLabel={viewDetailsLabel} swapLabel={swapLabel} swapIcon={swapIcon} swapPromptLabel={swapPromptLabel} swapCancelLabel={swapCancelLabel} isSwapSource={swapCandidate === course.name} onSwapClick={() => handleSwapClick(course.name)} isDraggable={isDraggable} />
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </AvailableDropZone>
              </div>
            )}

            <DragOverlay dropAnimation={null}>
              {activeCourse ? (
                <DragOverlayCard
                  course={activeCourse}
                  overSlotColor={overlaySlotColor}
                  viewDetailsLabel={viewDetailsLabel}
                />
              ) : null}
            </DragOverlay>
          </DndContext>

          {pathTools.length > 0 && (
            <div className="mt-5 md:mt-[27px]">
              <div className="text-[11px] md:text-[14px] font-bold tracking-[0.09em] uppercase mb-2 md:mb-3 text-center" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
                {data.tools_label ?? "Tools in this path"}
              </div>
              {!data.tools_marquee ? (
                <div className="flex flex-wrap gap-[5px] md:gap-[7px] justify-center">
                  {pathTools.map((tool) => (
                    <span
                      key={tool}
                      className={toolBadgeClassName}
                      style={{
                        ...toolBadgeStyle,
                        marginRight: 0,
                        background: "hsl(var(--background))",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "hsl(var(--primary) / 0.1)";
                        e.currentTarget.style.color = "hsl(var(--primary))";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "hsl(var(--background))";
                        e.currentTarget.style.color = "hsl(var(--muted-foreground))";
                      }}
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-1 md:gap-[5px]">
                  <div className="mx-2 md:mx-[60px]">
                    <CSSMarquee direction="fwd" speed={80} maskStyle={maskStyle}>
                      {row1.map((item, i) => <span key={i} className={toolBadgeClassName} style={toolBadgeStyle}>{item}</span>)}
                    </CSSMarquee>
                  </div>
                  {useTwoRows && (
                    <CSSMarquee direction="rev" speed={80} maskStyle={maskStyle}>
                      {row2.map((item, i) => <span key={i} className={toolBadgeClassName} style={toolBadgeStyle}>{item}</span>)}
                    </CSSMarquee>
                  )}
                </div>
              )}
            </div>
          )}

          {data.cta.banner ? (
            <div
              className="rounded-[13px] px-4 py-4 md:px-[1.4rem] md:py-[1.2rem] flex flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4 mt-6 md:mt-[35px]"
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
                    <a
                      key={i}
                      href={btn.url}
                      onClick={nav}
                      className="rounded-[8px] px-4 py-2 md:px-[18px] md:py-[10px] text-[12px] md:text-[13px] font-bold cursor-pointer whitespace-nowrap flex-shrink-0 transition-opacity duration-150 hover:opacity-90"
                      style={{ background: "hsl(var(--background))", color: "hsl(var(--primary))", textDecoration: "none" }}
                    >
                      {btn.text}
                    </a>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4 mt-[35px]">
              <div className="flex gap-2 flex-shrink-0">
                {data.cta.buttons.map((btn, i) => (
                  <a
                    key={i}
                    href={btn.url}
                    onClick={nav}
                    className="rounded-[8px] px-[22px] py-[10px] text-[13px] font-bold cursor-pointer whitespace-nowrap flex-shrink-0 transition-opacity duration-150 hover:opacity-90"
                    style={{ background: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))", textDecoration: "none" }}
                  >
                    {btn.text}
                  </a>
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
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
