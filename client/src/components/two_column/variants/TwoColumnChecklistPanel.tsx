import { useEffect, useRef, useState } from "react";
import { CircleCheck } from "lucide-react";
import type { TwoColumnSection } from "@shared/schema";
import { UniversalImage } from "@/components/UniversalImage";
import { getIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

interface TwoColumnChecklistPanelProps {
  data: TwoColumnSection;
}

const REVEAL_STEP_MS = 120;

/** Flips to true the first time the element is 20% on screen, then stops observing. */
function useRevealOnce<T extends Element>() {
  const ref = useRef<T | null>(null);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || revealed) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.2 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [revealed]);
  return { ref, revealed };
}

function revealClass(revealed: boolean) {
  return cn(
    "transition-[opacity,transform] duration-700 ease-out",
    !revealed && "motion-safe:opacity-0 motion-safe:translate-y-4",
  );
}

function headingHtml(heading: string, highlight?: string) {
  const start = highlight ? heading.indexOf(highlight) : -1;
  if (!highlight || start === -1) return heading;
  const end = start + highlight.length;
  return `${heading.slice(0, start)}<span class="block text-primary">${heading.slice(start, end)}</span>${heading.slice(end)}`;
}

export default function TwoColumnChecklistPanel({ data }: TwoColumnChecklistPanelProps) {
  const left = data.left ?? {};
  const right = data.right ?? {};
  const bullets = right.bullets ?? [];
  const BulletIcon = (right.bullet_icon && getIcon(right.bullet_icon)) || CircleCheck;
  const { ref: textRef, revealed } = useRevealOnce<HTMLDivElement>();
  const delay = (step: number) => ({ transitionDelay: revealed ? `${step * REVEAL_STEP_MS}ms` : "0ms" });

  return (
    <section className="overflow-hidden" data-testid="section-two-column-checklist-panel">
      <div className="max-w-6xl mx-auto px-4 grid gap-10 lg:grid-cols-2 lg:gap-16 items-center">
        <div className="order-2 lg:order-1 -mx-4 lg:mx-0 lg:ml-[min(-1rem,calc((72rem-100vw)/2-1rem))]">
          <div className="lg:rounded-r-3xl bg-primary/5 px-4 py-8 lg:py-12 lg:pr-12 lg:pl-[max(1rem,calc((100vw-72rem)/2+1rem))] flex justify-center lg:justify-end">
            {left.image && (
              <UniversalImage
                id={left.image}
                alt={left.image_alt ?? ""}
                className="w-full max-w-md h-auto"
                data-testid="img-two-column-checklist-panel"
                fieldContext={{ fieldPath: "left.image" }}
              />
            )}
          </div>
        </div>

        <div ref={textRef} className="order-1 lg:order-2">
          {right.heading && (
            <h2
              className={cn(
                "font-heading font-bold text-4xl md:text-5xl leading-tight tracking-tight text-foreground [&_p]:m-0",
                revealClass(revealed),
              )}
              style={delay(0)}
              data-testid="text-two-column-checklist-heading"
              dangerouslySetInnerHTML={{ __html: headingHtml(right.heading, right.heading_highlight) }}
            />
          )}
          {right.description && (
            <p
              className={cn("mt-4 text-lg text-muted-foreground", revealClass(revealed))}
              style={delay(1)}
              data-testid="text-two-column-checklist-description"
            >
              {right.description}
            </p>
          )}
          {bullets.length > 0 && (
            <ul className="mt-8 space-y-6" data-testid="list-two-column-checklist">
              {bullets.map((bullet, index) => (
                <li
                  key={index}
                  className={cn("flex gap-4", revealClass(revealed))}
                  style={delay(index + 2)}
                  data-testid={`two-column-checklist-item-${index}`}
                >
                  <BulletIcon className="mt-0.5 h-6 w-6 flex-shrink-0 text-primary" strokeWidth={1.75} />
                  <div>
                    {bullet.heading && <h3 className="text-lg font-semibold text-foreground">{bullet.heading}</h3>}
                    {bullet.text && <p className="mt-1 text-base text-muted-foreground">{bullet.text}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
