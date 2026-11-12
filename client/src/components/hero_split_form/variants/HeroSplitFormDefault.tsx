import { lazy, Suspense } from "react";
import { Check } from "lucide-react";
import type { LeadFormData } from "@shared/schema";
import RigobotSidePeek from "@/components/custom-icons/RigobotSidePeek";
import { getIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

const LeadForm = lazy(() => import("@/components/lead_form/variants/LeadFormDefault"));

interface HeroSplitFormStat {
  prefix?: string;
  value: string;
  label?: string;
}

interface HeroSplitFormCard {
  badge?: { icon?: string; text: string };
  title?: string;
  subtitle?: string;
  reassurance?: string;
}

interface HeroSplitFormSection {
  type: "hero_split_form";
  version?: string;
  variant?: "default" | "checklist";
  eyebrow?: string;
  eyebrow_dot?: "primary" | "green";
  heading: string;
  heading_highlight?: string;
  description?: string;
  stats?: HeroSplitFormStat[];
  bullets?: { text: string }[];
  show_rigobot?: boolean;
  footer?: string;
  form_card?: HeroSplitFormCard;
  form: LeadFormData;
}

interface HeroSplitFormDefaultProps {
  data: HeroSplitFormSection;
}

function headingHtml(heading: string, highlight?: string) {
  const start = highlight ? heading.indexOf(highlight) : -1;
  if (!highlight || start === -1) return heading;
  const end = start + highlight.length;
  return `${heading.slice(0, start)}<em class="text-primary">${heading.slice(start, end)}</em>${heading.slice(end)}`;
}

function FormFallback() {
  return <div className="min-h-64 flex items-center justify-center text-sm text-muted-foreground">Loading...</div>;
}

export default function HeroSplitFormDefault({ data }: HeroSplitFormDefaultProps) {
  const isChecklist = data.variant === "checklist";
  const stats = isChecklist ? [] : (data.stats ?? []).slice(0, 3);
  const bullets = isChecklist ? (data.bullets ?? []).slice(0, 6) : [];
  const card = data.form_card ?? {};
  const BadgeIcon = card.badge?.icon ? getIcon(card.badge.icon) : null;

  return (
    <section className="relative" data-testid="section-hero-split-form">
      <div className="max-w-6xl mx-auto px-4 grid gap-10 lg:grid-cols-[7fr_5fr] lg:gap-16 items-center">
        <div className="min-w-0">
          {data.eyebrow && (
            <p
              className="flex items-center gap-3 text-xs font-semibold uppercase tracking-widest text-primary"
              data-testid="text-hero-split-form-eyebrow"
            >
              <span
                className={cn("w-2 h-2 rounded-full flex-shrink-0", data.eyebrow_dot !== "green" && "bg-primary")}
                style={data.eyebrow_dot === "green" ? { background: "hsl(var(--color-green))" } : undefined}
              />
              {data.eyebrow}
            </p>
          )}

          <h1
            className="mt-5 font-heading font-black text-5xl lg:text-6xl leading-[1.05] tracking-tight text-foreground [&_p]:m-0"
            data-testid="text-hero-split-form-heading"
            dangerouslySetInnerHTML={{ __html: headingHtml(data.heading, data.heading_highlight) }}
          />

          {data.description && (
            <p className="mt-6 max-w-xl text-base md:text-lg leading-relaxed text-foreground" data-testid="text-hero-split-form-description">
              {data.description}
            </p>
          )}

          {stats.length > 0 && (
            <ul className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl" data-testid="list-hero-split-form-stats">
              {stats.map((stat, index) => (
                <li
                  key={index}
                  className="rounded-card bg-primary/5 p-4 flex flex-col justify-end"
                  data-testid={`hero-split-form-stat-${index}`}
                >
                  {stat.prefix && <span className="text-xs text-muted-foreground">{stat.prefix}</span>}
                  <span className="text-2xl font-semibold leading-tight text-primary">{stat.value}</span>
                  {stat.label && <span className="mt-1 text-xs text-foreground">{stat.label}</span>}
                </li>
              ))}
            </ul>
          )}

          {bullets.length > 0 && (
            <ul className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 max-w-xl" data-testid="list-hero-split-form-bullets">
              {bullets.map((bullet, index) => (
                <li
                  key={index}
                  className="flex items-start gap-3 text-base text-foreground"
                  data-testid={`hero-split-form-bullet-${index}`}
                >
                  <Check className="h-5 w-5 mt-0.5 flex-shrink-0 text-primary" />
                  {bullet.text}
                </li>
              ))}
            </ul>
          )}

          {data.footer && (
            <p className="mt-6 text-xs text-muted-foreground" data-testid="text-hero-split-form-footer">
              {data.footer}
            </p>
          )}
        </div>

        <div className="relative w-full max-w-md mx-auto lg:mr-0 pt-4">
          <div
            className="relative rounded-card border bg-card p-6 shadow-[0_1px_2px_hsl(var(--foreground)/0.04),0_8px_16px_-4px_hsl(var(--foreground)/0.06),0_24px_48px_-12px_hsl(var(--primary)/0.18)]"
            data-testid="hero-split-form-card"
          >
            {data.show_rigobot && <RigobotSidePeek />}
            {card.badge?.text && (
              <span
                className="absolute -top-3.5 left-5 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-card px-3 py-1 text-xs font-medium text-primary shadow-sm"
                data-testid="badge-hero-split-form-card"
              >
                {BadgeIcon && <BadgeIcon className="h-3.5 w-3.5" />}
                {card.badge.text}
              </span>
            )}
            {card.title && (
              <h2 className="text-2xl font-semibold leading-tight text-foreground" data-testid="text-hero-split-form-card-title">
                {card.title}
              </h2>
            )}
            {card.subtitle && (
              <p className="mt-2 text-sm text-muted-foreground" data-testid="text-hero-split-form-card-subtitle">
                {card.subtitle}
              </p>
            )}
            <div className={cn((card.title || card.subtitle) && "mt-5")}>
              <Suspense fallback={<FormFallback />}>
                <LeadForm
                  data={
                    {
                      ...data.form,
                      variant: data.form.variant || "stacked",
                      show_terms: data.form.show_terms ?? true,
                      className: "w-full",
                    } as LeadFormData
                  }
                />
              </Suspense>
            </div>
            {card.reassurance && (
              <p className="mt-4 flex items-start gap-2 text-sm text-muted-foreground" data-testid="text-hero-split-form-reassurance">
                <Check className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
                {card.reassurance}
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
