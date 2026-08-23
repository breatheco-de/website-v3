
import type { HeroSimpleStacked as HeroSimpleStackedType } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { createElement } from "react";
import { getIcon } from "@/lib/icons";
import { useInternalNav } from "@/hooks/useInternalNav";
import { UniversalImage } from "@/components/UniversalImage";
import { resolveTemplateFallback, coerceToText } from "@/lib/variable-manager";
import { resolveSectionBackground } from "@/lib/section-background";

interface HeroSimpleStackedProps {
  data: HeroSimpleStackedType;
}

export default function HeroSimpleStacked({ data }: HeroSimpleStackedProps) {
  const handleLinkClick = useInternalNav();
  const badgeText = coerceToText(data.badge);
  const titleText = coerceToText(data.title);
  const subtitleText = coerceToText(data.subtitle);
  const sectionBg = resolveSectionBackground(
    data.background || "bg-gradient-to-b from-primary/5 to-background",
  );
  return (
    <section 
      className={sectionBg.className}
      style={sectionBg.style}
      data-testid="section-hero"
    >
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex flex-col items-center text-center">
          <div className="max-w-2xl mb-4">
            {badgeText && (
              <span 
                className="inline-block bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-4"
                data-testid="text-hero-badge"
              >
                {badgeText}
              </span>
            )}
            
            <h1 
              className="text-h1 mb-4 text-foreground"
              data-testid="text-hero-title"
            >
              {titleText}
            </h1>
            
            {subtitleText && (
              <p 
                className="text-body text-muted-foreground mb-6 leading-relaxed"
                data-testid="text-hero-subtitle"
              >
                {subtitleText}
              </p>
            )}

            {data.cta_buttons && data.cta_buttons.length > 0 && (
              <div className="flex flex-wrap gap-4 justify-center">
                {data.cta_buttons.map((button, index) => (
                  <Button
                    key={index}
                    variant={button.variant === "primary" ? "default" : button.variant}
                    size="lg"
                    asChild
                    data-testid={`button-hero-cta-${index}`}
                  >
                    <a href={button.url} onClick={handleLinkClick} className="flex items-center gap-2">
                      {button.icon && (() => { const Ic = getIcon(button.icon); return Ic ? createElement(Ic, { className: "h-4 w-4" }) : null; })()}
                      {button.text}
                    </a>
                  </Button>
                ))}
              </div>
            )}
          </div>

          <div className="w-full max-w-md">
            <UniversalImage
              id={resolveTemplateFallback(data.image?.src ?? "")}
              alt={data.image?.alt}
              className="w-full h-auto rounded-card shadow-card"
              fieldContext={{ fieldPath: "image.src" }}
              loading="eager"
              data-testid="img-hero"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
