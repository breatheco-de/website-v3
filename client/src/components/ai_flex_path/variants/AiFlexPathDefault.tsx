import { useState, useEffect, useMemo } from "react";
import { CSSMarquee } from "@/components/ui/CSSMarquee";
import { getIcon } from "@/lib/icons";
import { InternalLink } from "@/components/InternalLink";
import type { AiFlexPathDefault } from "@shared/schema";

type Course = AiFlexPathDefault["courses"][0];

function SkillBar({ name, skill_percentage, animate }: { name: string; skill_percentage: number; animate: boolean }) {
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
      className="flex items-center gap-2 group/skill"
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
            background: hovered ? "hsl(var(--primary) / 0.85)" : "hsl(var(--primary))",
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

function CourseCard({
  course,
  isSelected,
  isRecommended,
  skillsLabel,
  onToggle,
}: {
  course: Course;
  isSelected: boolean;
  isRecommended: boolean;
  skillsLabel: string;
  onToggle: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [hovered, setHovered] = useState(false);

  const checkboxShadow = hovered
    ? isSelected
      ? "inset 0 0 0 1.8px hsl(var(--primary) / 0.7)"
      : "0 0 0 1.8px hsl(var(--border)), inset 0 0 0 1.8px hsl(var(--primary) / 0.18)"
    : isSelected
      ? "none"
      : "0 0 0 1.8px hsl(var(--border))";

  return (
    <div
      className="rounded-[13px] border-[1.5px] cursor-pointer select-none transition-all duration-200"
      style={{
        borderColor: isSelected ? "#0d6efd" : "hsl(var(--border))",
        background: isSelected ? "#f8fbff" : "hsl(var(--background))",
        opacity: isSelected ? 1 : 0.6,
        boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)",
        transition: "border-color .2s, box-shadow .2s, transform .18s, opacity .2s",
      }}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        el.style.opacity = "1";
        el.style.boxShadow = "0 3px 10px hsl(var(--primary) / 0.08), 0 8px 22px hsl(var(--primary) / 0.05)";
        el.style.transform = "translateY(-2px)";
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.opacity = isSelected ? "1" : "0.6";
        el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)";
        el.style.transform = "none";
      }}
      onClick={() => onToggle(course.name)}
    >
      <div
        className="flex items-start gap-[10px] p-[13px] pb-[10px]"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div
          className="w-5 h-5 rounded-full flex-shrink-0 mt-px flex items-center justify-center transition-all duration-150"
          style={{
            background: isSelected ? "hsl(var(--primary))" : "transparent",
            boxShadow: checkboxShadow,
          }}
        >
          <div
            className="w-[7px] h-[7px] rounded-full bg-background transition-all duration-200"
            style={{ opacity: isSelected ? 1 : 0, transform: isSelected ? "scale(1)" : "scale(0.4)" }}
          />
        </div>
        <div className="flex-1 min-w-0">
          <div
            className="text-[15px] font-bold leading-[1.3] mb-[2px]"
            style={{ color: !isSelected ? "hsl(var(--muted-foreground) / 0.6)" : "hsl(var(--foreground))" }}
          >
            {course.name}
          </div>
          <div className="text-[12px] leading-[1.4]" style={{ color: isSelected ? "hsl(var(--primary) / 0.6)" : "hsl(var(--muted-foreground) / 0.4)" }}>
            {course.tagline}
          </div>
        </div>
        <div
          className="text-[10px] px-[7px] py-[2px] rounded-full font-semibold whitespace-nowrap flex-shrink-0"
          style={{ color: "hsl(var(--muted-foreground) / 0.5)", background: "hsl(var(--muted))" }}
        >
          {course.hrs}
        </div>
      </div>

      <div
        className="flex items-center gap-[4px] px-[13px] pb-[10px] pt-[14px] mt-[-14px] cursor-pointer w-full origin-left"
        style={{
          transform: btnHovered ? "scale(1.06)" : "scale(1)",
          transition: "transform 150ms ease",
        }}
        onClick={(e) => { e.stopPropagation(); setExpanded((x) => !x); }}
        onMouseEnter={() => setBtnHovered(true)}
        onMouseLeave={() => setBtnHovered(false)}
      >
        <span
          className="text-[11px] font-bold tracking-[0.07em] uppercase"
          style={{ color: "hsl(var(--primary))" }}
        >
          {skillsLabel}
        </span>
        <span
          className="text-[18px] leading-none transition-transform duration-200"
          style={{
            color: "hsl(var(--primary))",
            transform: expanded ? "rotate(180deg)" : "none",
            display: "inline-block",
          }}
        >
          ▾
        </span>
      </div>

      <div
        className="overflow-hidden transition-all duration-300"
        style={{
          maxHeight: expanded ? 160 : 0,
          borderTop: expanded ? "1px solid hsl(var(--border))" : "none",
        }}
        onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
      >
        <div className="px-[13px] pt-[10px] pb-[13px] flex flex-col gap-2">
          {course.skills.map((s) => (
            <SkillBar key={s.name} name={s.name} skill_percentage={s.skill_percentage} animate={expanded} />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AiFlexPathDefault({ data }: { data: AiFlexPathDefault }) {
  const [selectedCourses, setSelectedCourses] = useState<Set<string>>(new Set(data.default_courses));
  const [counterFlash, setCounterFlash] = useState(false);
  const maxSelections = data.max_selections ?? 4;

  const pathTools = useMemo(() => {
    const seen = new Set<string>();
    const tools: string[] = [];
    data.default_courses.forEach((cName) => {
      const course = data.courses.find((c) => c.name === cName);
      course?.tools?.forEach((t) => {
        if (!seen.has(t)) { seen.add(t); tools.push(t); }
      });
    });
    return tools;
  }, [data.default_courses, data.courses]);

  function toggleCourse(name: string) {
    setSelectedCourses((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        if (next.size >= maxSelections) {
          setCounterFlash(true);
          setTimeout(() => setCounterFlash(false), 800);
          return prev;
        }
        next.add(name);
      }
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

  const RobotIcon = data.icon ? getIcon(data.icon) : null;

  return (
    <div className="pb-16" style={{ fontFamily: "'Inter',system-ui,-apple-system,sans-serif" }}>
      <div className="mx-auto">
        <div className="relative mx-28">
          <div className="absolute" style={{ right: "calc(100% + 16px)", top: "-16px" }}>
            {RobotIcon && <RobotIcon width="85" height="85" style={{ color: "hsl(var(--foreground))" }} />}
          </div>

          <div className="text-[11px] font-bold tracking-[0.09em] uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
            {data.ready_label ?? "Your path is ready"}
          </div>
          <div className="text-[30px] font-bold tracking-[-0.03em] leading-[1.1] mb-[0.6rem]" style={{ color: "hsl(var(--foreground))" }}>
            {data.path_name}
          </div>
          {data.tagline && (
            <div className="text-[13px] mb-6" style={{ color: "hsl(var(--muted-foreground) / 0.6)" }}>
              {data.tagline}
            </div>
          )}

          {/* Counter row */}
          <div className="flex items-center justify-between mb-4">
            <div className="text-[11px] font-bold tracking-[0.09em] uppercase" style={{ color: "hsl(var(--muted-foreground) / 0.5)" }}>
              {data.results_subtitle ?? "View your courses or build your own path"}
            </div>
            <div
              className="text-[11px] font-bold px-[10px] py-[3px] rounded-full border transition-all duration-300"
              style={{
                color: counterFlash ? "hsl(var(--destructive))" : "hsl(var(--primary))",
                background: counterFlash ? "hsl(var(--destructive) / 0.08)" : "hsl(var(--primary) / 0.08)",
                borderColor: counterFlash ? "hsl(var(--destructive) / 0.35)" : "hsl(var(--primary) / 0.25)",
              }}
            >
              {selectedCourses.size} / {maxSelections} {data.counter_label ?? "selected"}
            </div>
          </div>

          {/* Course grid */}
          <div className="grid grid-cols-2 gap-[9px] items-start">
            {[
              ...data.courses.filter((c) => data.default_courses.includes(c.name)),
              ...data.courses.filter((c) => !data.default_courses.includes(c.name)),
            ].map((course) => (
              <CourseCard
                key={course.name}
                course={course}
                isSelected={selectedCourses.has(course.name)}
                isRecommended={data.default_courses.includes(course.name)}
                skillsLabel={data.skills_breakdown_label ?? "Skills breakdown"}
                onToggle={toggleCourse}
              />
            ))}
          </div>

          {/* Tools */}
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
                      style={toolBadgeStyle}
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

          {/* CTA */}
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
  );
}
