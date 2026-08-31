import { useState, useEffect, useMemo, useRef } from "react";
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
import { IconBookFilled, IconGripVertical } from "@tabler/icons-react";
import { CSSMarquee } from "@/components/ui/CSSMarquee";
import { getIcon } from "@/lib/icons";
import UniversalImage from "@/components/UniversalImage";
import { InternalLink } from "@/components/InternalLink";
import { resolveColorVar, hslColor, type ResolvedColor } from "@/components/course_selector/shared";
import type { AiFlexPathDragAndDrop } from "@shared/schema";

type Course = AiFlexPathDragAndDrop["courses"][0];

const DEFAULT_COURSE_COLORS = [
  "hsl(0 84% 60%)",
  "hsl(45 96% 53%)",
  "hsl(142 71% 45%)",
  "hsl(330 80% 62%)",
];

function getCourseColorResolved(course: Course, allCourses: Course[]): ResolvedColor {
  if (course.color) return resolveColorVar(course.color);
  const idx = allCourses.findIndex((c) => c.name === course.name);
  return resolveColorVar(DEFAULT_COURSE_COLORS[idx % DEFAULT_COURSE_COLORS.length]);
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
  revealed,
  dropKey,
  activeCourse,
  allCourses,
  viewDetailsLabel,
  replaceLabel,
}: {
  course: Course;
  index: number;
  total: number;
  isOver: boolean;
  isDragActive: boolean;
  revealed: boolean;
  dropKey: number;
  activeCourse: Course | null;
  allCourses: Course[];
  viewDetailsLabel: string;
  replaceLabel: string;
}) {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const [expanded, setExpanded] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [popping, setPopping] = useState(false);
  const [hovered, setHovered] = useState(false);

  const resolved = getCourseColorResolved(course, allCourses);
  const acResolved = activeCourse ? getCourseColorResolved(activeCourse, allCourses) : resolved;
  const CourseIcon = course.icon ? getIcon(course.icon) : null;

  useEffect(() => {
    if (dropKey === 0) return;
    setPopping(true);
    const t = setTimeout(() => setPopping(false), 500);
    return () => clearTimeout(t);
  }, [dropKey]);

  const nodeDelay = index * 280;
  const cardDelay = nodeDelay + 100;
  const lineDelay = nodeDelay + 30;

  const { setNodeRef } = useDroppable({ id: `path-slot-${index}` });

  return (
    <div ref={setNodeRef} className="relative flex gap-5 items-center">
      {!isFirst && (
        <div className="absolute z-0" style={{
          left: 15, top: 0, bottom: "50%", width: 2,
          background: expanded ? "hsl(var(--background))" : "transparent",
          transition: expanded ? "background 0ms" : "background 0ms 300ms",
        }}>
          <div style={{
            width: "100%", height: "100%",
            background: "hsl(var(--primary))", opacity: expanded ? 0.25 : 0,
            transition: expanded ? "opacity 0ms" : "opacity 0ms 300ms",
          }} />
        </div>
      )}
      {!isLast && (
        <div className="absolute z-0" style={{ left: 15, top: "50%", height: "100%", width: 2, overflow: "hidden", background: "hsl(var(--background))" }}>
          <div style={{
            width: "100%", height: "100%",
            background: "hsl(var(--primary))", opacity: 0.25,
            transformOrigin: "top",
            transform: revealed ? "scaleY(1)" : "scaleY(0)",
            transition: `transform 250ms cubic-bezier(.4,0,.2,1) ${lineDelay}ms`,
          }} />
        </div>
      )}

      <div className="flex-shrink-0 z-10 flex items-center justify-center" style={{ width: 32 }}>
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold"
          style={{
            background: isOver ? "hsl(var(--primary) / 0.75)" : "hsl(var(--primary))",
            color: "white",
            transform: revealed ? "scale(1)" : "scale(0)",
            transition: `transform 300ms cubic-bezier(.34,1.56,.64,1) ${nodeDelay}ms`,
          }}
        >
          {index + 1}
        </div>
      </div>

      <style>{`@keyframes path-card-pop { 0%{transform:translateX(0) scale(1)} 40%{transform:translateX(0) scale(1.018)} 100%{transform:translateX(0) scale(1)} }`}</style>
      <div
        className="flex-1 my-[6px] rounded-[13px]"
        style={{
          background: isOver ? hslColor(acResolved, 0.05) : "hsl(var(--background))",
          border: isOver ? `2px dashed ${hslColor(acResolved, 0.55)}` : "2px solid transparent",
          boxShadow: isOver
            ? "none"
            : hovered
              ? `0 3px 10px ${hslColor(resolved, 0.13)}, 0 8px 22px ${hslColor(resolved, 0.08)}`
              : "0 1px 4px rgba(0,0,0,0.09), 0 4px 14px rgba(0,0,0,0.07)",
          opacity: revealed ? 1 : 0,
          transform: popping ? undefined : revealed ? (hovered ? "translateX(0) translateY(-2px)" : "translateX(0)") : "translateX(-10px)",
          transition: popping
            ? "box-shadow 200ms"
            : revealed
              ? "transform 180ms ease, box-shadow 200ms"
              : `opacity 240ms ease ${cardDelay}ms, transform 260ms cubic-bezier(.4,0,.2,1) ${cardDelay}ms, box-shadow 200ms`,
          animation: popping ? "path-card-pop 0.45s cubic-bezier(.34,1.56,.64,1)" : "none",
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {isOver && isDragActive && activeCourse ? (
          <div className="relative">
            <div style={{ opacity: 0, pointerEvents: "none", userSelect: "none" }}>
              <div className="flex items-start gap-[10px] px-[15px] pt-[14px] pb-[12px]">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-[6px] mb-[4px]">
                    {CourseIcon ? <CourseIcon size={17} style={{ color: hslColor(resolved, 1), flexShrink: 0 }} /> : <IconBookFilled size={17} style={{ color: hslColor(resolved, 1), flexShrink: 0 }} />}
                    <div className="text-[16px] font-extrabold leading-[1.3]" style={{ color: "hsl(var(--foreground))" }}>{course.name}</div>
                  </div>
                  <div className="text-[13px] leading-[1.4] pl-[23px] mb-[8px]" style={{ color: "hsl(var(--muted-foreground))" }}>{course.tagline}</div>
                  <div className="flex flex-wrap items-center gap-[5px] pl-[23px]">
                    {course.tools.slice(0, 3).map((t) => (
                      <span key={t} className="text-[10px] font-semibold px-[7px] py-[2px] rounded-full" style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.1) }}>{t}</span>
                    ))}
                  </div>
                </div>
                <div className="flex flex-col items-end justify-between flex-shrink-0 self-stretch">
                  <div className="text-[9px] px-[6px] py-[2px] rounded-full font-semibold" style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.12) }}>{course.hrs}</div>
                </div>
              </div>
            </div>
            <div className="absolute inset-0 flex items-start" style={{ paddingLeft: 38, paddingTop: 14 }}>
              <div className="text-[16px] font-extrabold leading-[1.3]" style={{ color: hslColor(acResolved, 1) }}>
                {replaceLabel} {activeCourse.name}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-[10px] px-[15px] pt-[14px] pb-[12px]">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-[6px] mb-[4px]">
                {CourseIcon ? <CourseIcon size={17} style={{ color: hslColor(resolved, 1), flexShrink: 0 }} /> : <IconBookFilled size={17} style={{ color: hslColor(resolved, 1), flexShrink: 0 }} />}
                <div className="text-[16px] font-extrabold leading-[1.3]" style={{ color: "hsl(var(--foreground))" }}>
                  {course.name}
                </div>
              </div>
              <div className="text-[14px] leading-[1.4] pl-[23px] mb-[8px]" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
                {course.tagline}
              </div>
              <div className="flex flex-wrap items-center gap-[5px] pl-[23px]">
                {course.tools.map((tool) => (
                  <span
                    key={tool}
                    className="text-[10px] font-semibold px-[7px] py-[2px] rounded-full whitespace-nowrap"
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
            </div>

            <div className="flex flex-col items-end justify-between flex-shrink-0 self-stretch">
              <div
                className="text-[9px] px-[6px] py-[2px] rounded-full font-semibold whitespace-nowrap"
                style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.12) }}
              >
                {course.hrs}
              </div>
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
                <span
                  className="text-[13px] leading-none transition-transform duration-200"
                  style={{ display: "inline-block", transform: expanded ? "rotate(180deg)" : "none" }}
                >
                  ▾
                </span>
              </div>
            </div>
          </div>
        )}

        <div
          className="overflow-hidden transition-all duration-300"
          style={{
            maxHeight: expanded ? 300 : 0,
            borderTop: expanded ? `1px solid ${hslColor(resolved, 0.15)}` : "none",
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
      </div>
    </div>
  );
}

function DraggableCourseCard({
  course,
  allCourses,
  viewDetailsLabel,
}: {
  course: Course;
  allCourses: Course[];
  viewDetailsLabel: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [hovered, setHovered] = useState(false);

  const resolved = getCourseColorResolved(course, allCourses);

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `draggable-${course.name}`,
    data: { courseName: course.name },
  });

  const dndTranslate = CSS.Translate.toString(transform) ?? "";
  const hoverLift = hovered && !isDragging ? "translateY(-2px)" : "";
  const outerTransform = [dndTranslate, hoverLift].filter(Boolean).join(" ") || undefined;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: outerTransform,
        touchAction: "none",
        cursor: isDragging ? "grabbing" : "grab",
        transition: isDragging ? "none" : "transform .18s",
      }}
      {...listeners}
      {...attributes}
      className="select-none"
    >
      <div
        style={{
          borderColor: hovered ? hslColor(resolved, 0.55) : "hsl(var(--border))",
          background: "hsl(var(--background))",
          opacity: isDragging ? 0 : hovered ? 1 : 0.6,
          boxShadow: hovered && !isDragging
            ? `0 3px 10px ${hslColor(resolved, 0.1)}, 0 8px 22px ${hslColor(resolved, 0.07)}`
            : "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)",
          transition: "border-color .2s, box-shadow .2s, opacity .2s",
        }}
        className="rounded-[13px] border-[1.5px]"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex items-stretch">
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="flex items-center gap-[5px] p-[13px] pb-[6px]">
              <IconGripVertical size={34} style={{ color: "hsl(var(--muted-foreground) / 0.6)", flexShrink: 0 }} />
              <div className="flex flex-col gap-[2px] flex-1 min-w-0">
                <div className="flex items-start gap-[7px]">
                  {(() => { const CI = course.icon ? getIcon(course.icon) : null; return CI ? <CI size={14} style={{ color: hovered ? hslColor(resolved, 1) : "hsl(var(--foreground) / 0.45)", transition: "color .2s", flexShrink: 0, marginTop: 2 }} /> : <IconBookFilled size={14} style={{ color: hovered ? hslColor(resolved, 1) : "hsl(var(--foreground) / 0.45)", transition: "color .2s", flexShrink: 0, marginTop: 2 }} />; })()}
                  <div
                    className="text-[15px] font-bold leading-[1.3]"
                    style={{ color: hovered ? hslColor(resolved, 1) : "hsl(var(--foreground) / 0.75)", transition: "color .2s" }}
                  >
                    {course.name}
                  </div>
                </div>
                <div className="text-[12px] leading-[1.4]" style={{ color: "hsl(var(--muted-foreground))" }}>
                  {course.tagline}
                </div>
              </div>
            </div>
            <div
              className="flex items-center gap-[4px] px-[13px] pb-[10px] pt-[10px] mt-auto cursor-pointer origin-left"
              style={{ transform: btnHovered ? "scale(1.06)" : "scale(1)", transition: "transform 150ms ease" }}
              onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
              onMouseEnter={() => setBtnHovered(true)}
              onMouseLeave={() => setBtnHovered(false)}
            >
              <span
                className="text-[11px] font-bold tracking-[0.07em] uppercase"
                style={{ color: hovered ? hslColor(resolved, 1) : "hsl(var(--primary))", transition: "color .2s" }}
              >
                {viewDetailsLabel}
              </span>
              <span
                className="text-[18px] leading-none"
                style={{
                  color: hovered ? hslColor(resolved, 1) : "hsl(var(--primary))",
                  transform: expanded ? "rotate(180deg)" : "none",
                  display: "inline-block",
                  transition: "color .2s, transform .2s",
                }}
              >
                ▾
              </span>
            </div>
          </div>
          <div className="flex items-start flex-shrink-0 p-[13px]">
            <div
              className="text-[10px] px-[7px] py-[2px] rounded-full font-semibold whitespace-nowrap"
              style={{
                color: hovered ? hslColor(resolved, 1) : "hsl(var(--muted-foreground) / 0.5)",
                background: hovered ? hslColor(resolved, 0.1) : "hsl(var(--muted-foreground) / 0.07)",
                transition: "color .2s, background .2s",
              }}
            >
              {course.hrs}
            </div>
          </div>
        </div>

        <div
          className="overflow-hidden transition-all duration-300"
          style={{
            maxHeight: expanded ? 260 : 0,
            borderTop: expanded ? `1px solid ${hslColor(resolved, 0.15)}` : "none",
          }}
          onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
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
      </div>
    </div>
  );
}

function DragOverlayCard({
  course,
  allCourses,
  viewDetailsLabel,
}: {
  course: Course;
  allCourses: Course[];
  viewDetailsLabel: string;
}) {
  const resolved = getCourseColorResolved(course, allCourses);
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
          <div className="flex items-center gap-[10px] p-[13px] pb-[6px]">
            <IconGripVertical size={34} style={{ color: "hsl(var(--muted-foreground) / 0.6)", flexShrink: 0 }} />
            <div className="flex flex-col gap-[2px] flex-1 min-w-0">
              <div className="flex items-start gap-[7px]">
                {(() => { const CI = course.icon ? getIcon(course.icon) : null; return CI ? <CI size={14} style={{ color: hslColor(resolved, 1), flexShrink: 0, marginTop: 2 }} /> : <IconBookFilled size={14} style={{ color: hslColor(resolved, 1), flexShrink: 0, marginTop: 2 }} />; })()}
                <div className="text-[15px] font-bold leading-[1.3]" style={{ color: hslColor(resolved, 1) }}>
                  {course.name}
                </div>
              </div>
              <div className="text-[12px] leading-[1.4]" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
                {course.tagline}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-[4px] px-[13px] pb-[10px] pt-[10px] mt-auto">
            <span className="text-[11px] font-bold tracking-[0.07em] uppercase" style={{ color: hslColor(resolved, 1) }}>
              {viewDetailsLabel}
            </span>
            <span className="text-[18px] leading-none" style={{ color: hslColor(resolved, 1) }}>▾</span>
          </div>
        </div>
        <div className="flex items-start flex-shrink-0 p-[13px]">
          <div
            className="text-[10px] px-[7px] py-[2px] rounded-full font-semibold whitespace-nowrap"
            style={{ color: hslColor(resolved, 1), background: hslColor(resolved, 0.1) }}
          >
            {course.hrs}
          </div>
        </div>
      </div>
    </div>
  );
}

function GhostPreviewCard({ course, allCourses }: { course: Course; allCourses: Course[] }) {
  const resolved = getCourseColorResolved(course, allCourses);
  return (
    <div
      className="rounded-[13px] border-[1.5px]"
      style={{
        borderColor: hslColor(resolved, 0.35),
        borderStyle: "dashed",
        background: hslColor(resolved, 0.04),
        opacity: 0.75,
      }}
    >
      <div className="flex items-stretch">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex items-center gap-[10px] p-[13px] pb-[6px]">
            <IconGripVertical size={34} style={{ color: "hsl(var(--muted-foreground) / 0.25)", flexShrink: 0 }} />
            <div className="flex flex-col gap-[2px] flex-1 min-w-0">
              <div className="flex items-start gap-[7px]">
                <IconBookFilled size={14} style={{ color: hslColor(resolved, 0.7), flexShrink: 0, marginTop: 2 }} />
                <div className="text-[15px] font-bold leading-[1.3]" style={{ color: hslColor(resolved, 0.8) }}>
                  {course.name}
                </div>
              </div>
              <div className="text-[12px] leading-[1.4]" style={{ color: "hsl(var(--muted-foreground) / 0.35)" }}>
                {course.tagline}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-[4px] px-[13px] pb-[10px] pt-[10px] mt-auto">
            <span className="text-[11px] font-bold tracking-[0.07em] uppercase" style={{ color: hslColor(resolved, 0.55) }}>
              ↑ goes here
            </span>
          </div>
        </div>
        <div className="flex items-start flex-shrink-0 p-[13px]">
          <div
            className="text-[10px] px-[7px] py-[2px] rounded-full font-semibold whitespace-nowrap"
            style={{ color: hslColor(resolved, 0.7), background: hslColor(resolved, 0.08) }}
          >
            {course.hrs}
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

export default function AiFlexPathDragAndDrop({ data }: { data: AiFlexPathDragAndDrop }) {
  const [pathCourseNames, setPathCourseNames] = useState<string[]>(data.default_courses);
  const [activeCourseName, setActiveCourseName] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const [counterFlash, setCounterFlash] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [dropCounts, setDropCounts] = useState<number[]>([0, 0, 0, 0, 0]);
  const lastOverSlotRef = useRef<number | null>(null);
  const [activeDeltaY, setActiveDeltaY] = useState(0);
  const maxSelections = data.max_selections ?? 4;
  const showAvailableCourses = data.show_available_courses !== false;
  const viewDetailsLabel = data.view_details_label ?? "View details";
  const replaceLabel = data.replace_label ?? "Replace with";
  const dragInstructionLabel = data.drag_instruction_label ?? "Also available — drag any card to swap it into your path";

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
    // Determine target slot: prefer event.over, fall back to last slot from onDragOver
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

    setPathCourseNames((prev) => {
      const next = [...prev];
      next[slotIndex!] = draggedName;
      return next;
    });
    setDropCounts((prev) => {
      const next = [...prev];
      next[slotIndex!] = (next[slotIndex!] || 0) + 1;
      return next;
    });
  }

  const toolBadgeStyle: React.CSSProperties = {
    fontFamily: "'SF Mono','Fira Code',monospace",
    fontSize: "15px",
    fontWeight: 600,
    color: "hsl(var(--muted-foreground))",
    background: "hsl(var(--background))",
    borderRadius: "9999px",
    padding: "7px 15px",
    whiteSpace: "nowrap",
    flexShrink: 0,
    cursor: "default",
    marginRight: 7,
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

  return (
    <div className="pb-16" style={{ fontFamily: "'Inter Variable',system-ui,-apple-system,sans-serif" }}>
      <div className="mx-auto">
        <div className="flex">
          <div className="w-28 flex-shrink-0 flex items-start justify-center pt-[2px]">
            <div className="mb-1">
              {data.image_id ? (
                <UniversalImage id={data.image_id} width={55} height={55} style={{ objectFit: "contain", width: "50px", height: "50px" }} />
              ) : SectionIcon ? (
                <SectionIcon width="55" height="55" style={{ color: "hsl(var(--foreground))" }} />
              ) : null}
            </div>
          </div>
          <div className="flex-1 min-w-0 mr-28">

          <div className="text-[11px] font-bold tracking-[0.09em] uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
            {data.ready_label}
          </div>
          <div className="text-[30px] font-bold tracking-[-0.03em] leading-[1.1] mb-[0.6rem]" style={{ color: "hsl(var(--foreground))" }}>
            {data.path_name}
          </div>
          {data.tagline && (
            <div className="text-[13px] mb-3" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
              {data.tagline}
            </div>
          )}

          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] font-bold tracking-[0.09em] uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
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
                      key={course.name}
                      course={course}
                      index={i}
                      total={pathCourses.length}
                      isOver={overSlot === i && !!activeCourseName && activeDeltaY < -40}
                      isDragActive={!!activeCourseName}
                      revealed={revealed}
                      dropKey={dropCounts[i] ?? 0}
                      activeCourse={activeCourse}
                      allCourses={data.courses}
                      viewDetailsLabel={viewDetailsLabel}
                      replaceLabel={replaceLabel}
                    />
                  ))}
                </div>
              </div>
            </div>

            {showAvailableCourses && availableCourses.length > 0 && (
              <div>
                <div className="text-[11px] font-bold tracking-[0.09em] uppercase mb-4" style={{ color: "hsl(var(--muted-foreground) / 0.45)" }}>
                  {dragInstructionLabel}
                </div>
                <AvailableDropZone isDragActive={!!activeCourseName}>
                  <div className="grid grid-cols-2 gap-[9px]">
                    {availableCourses.map((course) => {
                      const isBeingDragged = course.name === activeCourseName;
                      const displacedCourse = overSlot !== null && activeDeltaY < -40 ? pathCourses[overSlot] ?? null : null;
                      if (isBeingDragged && displacedCourse) {
                        return <GhostPreviewCard key={course.name} course={displacedCourse} allCourses={data.courses} />;
                      }
                      return (
                        <DraggableCourseCard
                          key={course.name}
                          course={course}
                          allCourses={data.courses}
                          viewDetailsLabel={viewDetailsLabel}
                        />
                      );
                    })}
                  </div>
                </AvailableDropZone>
              </div>
            )}

            <DragOverlay dropAnimation={null}>
              {activeCourse ? (
                <DragOverlayCard
                  course={activeCourse}
                  allCourses={data.courses}
                  viewDetailsLabel={viewDetailsLabel}
                />
              ) : null}
            </DragOverlay>
          </DndContext>

          {pathTools.length > 0 && (
            <div className="mt-[27px]">
              <div className="text-[14px] font-bold tracking-[0.09em] uppercase mb-3 text-center" style={{ color: "hsl(var(--muted-foreground) / 0.4)" }}>
                {data.tools_label ?? "Tools in this path"}
              </div>
              {!data.tools_marquee ? (
                <div className="flex flex-wrap gap-[7px] justify-center">
                  {pathTools.map((tool) => (
                    <span
                      key={tool}
                      style={{ ...toolBadgeStyle, marginRight: 0 }}
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
                <div className="flex flex-col gap-[5px]">
                  <div className="mx-[60px]">
                    <CSSMarquee direction="fwd" speed={80} maskStyle={maskStyle}>
                      {row1.map((item, i) => <span key={i} style={toolBadgeStyle}>{item}</span>)}
                    </CSSMarquee>
                  </div>
                  {useTwoRows && (
                    <CSSMarquee direction="rev" speed={80} maskStyle={maskStyle}>
                      {row2.map((item, i) => <span key={i} style={toolBadgeStyle}>{item}</span>)}
                    </CSSMarquee>
                  )}
                </div>
              )}
            </div>
          )}

          {data.cta.banner ? (
            <div
              className="rounded-[13px] px-[1.4rem] py-[1.2rem] flex items-center justify-between gap-4 mt-[35px]"
              style={{
                background: "hsl(var(--primary))",
                boxShadow: "0 4px 16px hsl(var(--primary) / 0.25)",
              }}
            >
              <div>
                <div className="text-[15px] font-bold mb-[2px]" style={{ color: "hsl(var(--primary-foreground))" }}>
                  {data.cta.title}
                </div>
                {data.cta.subtitle && (
                  <div className="text-[12px]" style={{ color: "hsl(var(--primary-foreground) / 0.6)" }}>
                    {data.cta.subtitle}
                  </div>
                )}
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {data.cta.buttons.map((btn, i) => (
                  <InternalLink
                    key={i}
                    href={btn.url}
                    className="rounded-[8px] px-[18px] py-[10px] text-[13px] font-bold cursor-pointer whitespace-nowrap flex-shrink-0 transition-opacity duration-150 hover:opacity-90"
                    style={{ background: "hsl(var(--background))", color: "hsl(var(--primary))", textDecoration: "none" }}
                  >
                    {btn.text}
                  </InternalLink>
                ))}
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
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
