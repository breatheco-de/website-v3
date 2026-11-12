import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface NumberedStepsTimelineStep {
  text: string;
  badge?: string;
  badge_style?: "soft" | "outline";
  icon?: string;
}

interface NumberedStepsTimelineSection {
  type: "numbered_steps";
  version?: string;
  variant: "timeline";
  eyebrow?: string;
  title: string;
  title_highlight?: string;
  description?: string;
  steps: NumberedStepsTimelineStep[];
  background?: string;
}

interface NumberedStepsTimelineProps {
  data: NumberedStepsTimelineSection;
}

type MarkerState = "upcoming" | "active" | "passed" | "done";

const STEP_TICK_MS = 520;
const INTRO_STAGGER_MS = 110;
const EASE_OUT = "ease-[cubic-bezier(.22,1,.36,1)]";

// Each step takes two ticks: its marker lights up, then the line to the next step fills.
function markerStateFor(index: number, total: number, stage: number): MarkerState {
  if (stage < index * 2) return "upcoming";
  if (index === total - 1) return "done";
  return Math.floor(stage / 2) === index ? "active" : "passed";
}

function revealProps(revealed: boolean, delayMs: number): { className: string; style: CSSProperties } {
  return {
    className: cn(
      "transition-[opacity,transform] duration-700 motion-reduce:transition-none",
      EASE_OUT,
      revealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4",
    ),
    style: { transitionDelay: `${delayMs}ms` },
  };
}

function renderTitle(title: string, highlight?: string) {
  const start = highlight ? title.indexOf(highlight) : -1;
  if (!highlight || start === -1) return title;
  const end = start + highlight.length;
  return (
    <>
      {title.slice(0, start)}
      <span className="text-primary">{title.slice(start, end)}</span>
      {title.slice(end)}
    </>
  );
}

function Marker({ state }: { state: MarkerState }) {
  const reached = state !== "upcoming";
  const done = state === "done";
  return (
    <div className="relative w-8 h-8">
      {done && (
        <span
          aria-hidden
          className="absolute inset-0 rounded-full bg-primary/40 motion-reduce:hidden"
          style={{ animation: "numbered-steps-halo 1.4s cubic-bezier(.22,1,.36,1) 120ms both" }}
        />
      )}
      <div
        className={cn(
          "relative w-8 h-8 rounded-full border-2 bg-background flex items-center justify-center",
          "transition-[border-color,box-shadow] duration-500 motion-reduce:transition-none",
          reached ? "border-primary" : "border-primary/25",
          state === "active" ? "ring-4 ring-primary/15" : "ring-0 ring-primary/15",
        )}
      >
        <span
          className={cn(
            "w-2.5 h-2.5 rounded-full transition-all duration-500 motion-reduce:transition-none",
            EASE_OUT,
            reached ? "bg-primary scale-100" : "bg-primary/30 scale-75",
            done && "opacity-0 scale-0",
          )}
        />
        <span
          className={cn(
            "absolute -inset-0.5 rounded-full bg-primary text-primary-foreground flex items-center justify-center",
            "transition-[opacity,transform,box-shadow] duration-500 ease-[cubic-bezier(.34,1.56,.64,1)] motion-reduce:transition-none",
            done ? "opacity-100 scale-100 shadow-lg shadow-primary/30" : "opacity-0 scale-50",
          )}
        >
          <Check
            className={cn(
              "w-4 h-4 transition-transform duration-500 delay-150 motion-reduce:transition-none",
              EASE_OUT,
              done ? "scale-100 rotate-0" : "scale-0 -rotate-45",
            )}
            strokeWidth={3}
          />
        </span>
      </div>
    </div>
  );
}

function StepBadge({ text, style = "soft" }: { text: string; style?: "soft" | "outline" }) {
  if (style === "outline") {
    return (
      <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-background px-3 py-1 text-xs font-medium text-foreground shadow-sm">
        <span className="w-1.5 h-1.5 rounded-full bg-primary" />
        {text}
      </span>
    );
  }
  return (
    <span className="mt-3 inline-flex items-center rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
      {text}
    </span>
  );
}

export default function NumberedStepsTimeline({ data }: NumberedStepsTimelineProps) {
  const steps = data.steps || [];
  const finalStage = Math.max(0, (steps.length - 1) * 2);
  const sectionRef = useRef<HTMLElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [stage, setStage] = useState(-1);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setReducedMotion(true);
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!revealed || steps.length === 0) return;
    if (reducedMotion) {
      setStage(finalStage);
      return;
    }
    let interval: ReturnType<typeof setInterval> | undefined;
    const introMs = 300 + steps.length * INTRO_STAGGER_MS + 300;
    const start = setTimeout(() => {
      setStage(0);
      interval = setInterval(() => {
        setStage((current) => {
          if (current >= finalStage) {
            clearInterval(interval);
            return finalStage;
          }
          return current + 1;
        });
      }, STEP_TICK_MS);
    }, introMs);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [revealed, reducedMotion, finalStage, steps.length]);

  const shownStage = Math.min(stage, finalStage);
  const eyebrowReveal = revealProps(revealed, 0);
  const titleReveal = revealProps(revealed, 100);
  const descriptionReveal = revealProps(revealed, 200);

  return (
    <section ref={sectionRef} data-testid="section-numbered-steps-timeline">
      <style>{`
        @keyframes numbered-steps-halo {
          0%   { opacity: 0.55; transform: scale(1); }
          100% { opacity: 0;    transform: scale(2.4); }
        }
      `}</style>
      <div className="max-w-6xl mx-auto px-4 grid gap-10 lg:grid-cols-[2fr_3fr] lg:gap-16">
        <div>
          {data.eyebrow && (
            <p
              className={cn(
                "flex items-center gap-2 mb-4 text-xs font-semibold uppercase tracking-[0.15em] text-primary",
                eyebrowReveal.className,
              )}
              style={eyebrowReveal.style}
              data-testid="text-numbered-steps-eyebrow"
            >
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: "hsl(var(--color-green))" }} />
              {data.eyebrow}
            </p>
          )}
          <h2
            className={cn(
              "text-3xl md:text-4xl font-heading font-bold leading-tight text-foreground",
              titleReveal.className,
            )}
            style={titleReveal.style}
            data-testid="text-numbered-steps-title"
          >
            {renderTitle(data.title, data.title_highlight)}
          </h2>
          {data.description && (
            <p
              className={cn("text-body text-muted-foreground mt-4", descriptionReveal.className)}
              style={descriptionReveal.style}
              data-testid="text-numbered-steps-description"
            >
              {data.description}
            </p>
          )}
        </div>

        <ol>
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            const state = markerStateFor(index, steps.length, shownStage);
            const lineFilled = shownStage >= index * 2 + 1;
            const reveal = revealProps(revealed, 300 + index * INTRO_STAGGER_MS);
            return (
              <li
                key={index}
                className={cn("grid grid-cols-[2rem_1fr] gap-x-5", reveal.className)}
                style={reveal.style}
                data-testid={`numbered-step-${index + 1}`}
              >
                <div className="flex flex-col items-center">
                  <Marker state={state} />
                  {!isLast && (
                    <div className="relative flex-1 w-0.5 my-1">
                      <div className="absolute inset-0 border-l-2 border-dotted border-primary/25" />
                      <div
                        className={cn(
                          "absolute inset-0 bg-primary origin-top rounded-full",
                          "transition-transform ease-in-out motion-reduce:transition-none",
                          lineFilled ? "scale-y-100" : "scale-y-0",
                        )}
                        style={{ transitionDuration: `${STEP_TICK_MS}ms` }}
                      />
                    </div>
                  )}
                </div>
                <div
                  className={cn(
                    "pt-0.5 transition-opacity duration-500 motion-reduce:transition-none",
                    !isLast && "pb-10",
                    state === "upcoming" ? "opacity-50" : "opacity-100",
                  )}
                >
                  <p className="text-lg font-semibold text-foreground">{step.text}</p>
                  {step.badge && <StepBadge text={step.badge} style={step.badge_style} />}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
