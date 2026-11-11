import { IconArrowRight } from "@tabler/icons-react";
import type { CtaBannerPromotion } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { useInternalNav } from "@/hooks/useInternalNav";

interface Props {
  data: CtaBannerPromotion;
}

export function CtaBannerPromotion({ data }: Props) {
  const handleLinkClick = useInternalNav();
  const { eyebrow, title, subtitle, cta_buttons } = data;

  return (
    <section
      className="flex w-full flex-col gap-6 rounded-[13px] border border-border bg-background px-6 py-5 sm:px-7 md:flex-row md:items-center md:justify-between md:gap-8"
      style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.04), 0 3px 10px rgba(0,0,0,0.03)" }}
    >
        {/* Left: eyebrow + title + subtitle */}
        <div className="min-w-0">
          {eyebrow && (
            <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.12em] text-muted-foreground">
              <span className="h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
              {eyebrow}
            </div>
          )}
          {title && (
            <h2
              className="font-inter font-extrabold leading-tight tracking-[-0.035em] text-[25px] sm:text-[27px]"
              dangerouslySetInnerHTML={{ __html: title }}
            />
          )}
          {subtitle && (
            <p className="mt-1.5 max-w-[510px] text-sm leading-5 text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>

        {/* Right: CTA buttons */}
        {cta_buttons && cta_buttons.length > 0 && (
          <div className="flex w-full shrink-0 flex-col gap-2.5 sm:flex-row md:w-auto">
            {cta_buttons.map((btn, i) => {
              const resolvedVariant = (btn.button_variant || btn.variant) as string;
              const variant =
                resolvedVariant === "link" ? "link"
                : resolvedVariant === "primary" ? "default"
                : resolvedVariant === "secondary" ? "secondary"
                : resolvedVariant === "outline" ? "outline"
                : resolvedVariant === "accent" ? "accent"
                : "default";
              const isPrimary = resolvedVariant === "primary";
              return (
                <Button
                  key={i}
                  variant={variant as any}
                  size="default"
                  asChild
                  className="w-full sm:w-auto"
                >
                  <a href={btn.url} onClick={handleLinkClick}>
                    {btn.text}
                    {isPrimary && <IconArrowRight size={16} aria-hidden="true" />}
                  </a>
                </Button>
              );
            })}
          </div>
        )}
    </section>
  );
}

export default CtaBannerPromotion;
