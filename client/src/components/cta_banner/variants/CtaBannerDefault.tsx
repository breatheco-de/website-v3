import { lazy, Suspense } from "react";
import type { CTABannerSection as CTABannerSectionType, CtaBannerDefault, CtaBannerForm, CtaBannerStrip, CtaBannerResourceShowcase, CtaBannerPromotion, CtaButton } from "@shared/schema";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useInternalNav } from "@/hooks/useInternalNav";
import { useSession } from "@/contexts/SessionContext";
import { CtaBannerStrip as CtaBannerStripComponent } from "./CtaBannerStrip";
import { CtaBannerResourceShowcase as CtaBannerResourceShowcaseComponent } from "./CtaBannerResourceShowcase";
import { CtaBannerPromotion as CtaBannerPromotionComponent } from "./CtaBannerPromotion";

const LeadForm = lazy(() => import("@/components/lead_form/variants/LeadFormDefault"));

function LeadFormFallback() {
  return (
    <div className="min-h-24 flex items-center justify-center text-primary-foreground/70 text-sm">
      Loading...
    </div>
  );
}

interface CTABannerSectionProps {
  data: CTABannerSectionType;
}

function isFormVariant(data: CTABannerSectionType): data is CtaBannerForm {
  return data.variant === "form";
}

function isDefaultVariant(data: CTABannerSectionType): data is CtaBannerDefault {
  return !data.variant || data.variant === "default";
}

function isStripVariant(data: CTABannerSectionType): data is CtaBannerStrip {
  return data.variant === "strip";
}

function isResourceShowcaseVariant(data: CTABannerSectionType): data is CtaBannerResourceShowcase {
  return data.variant === "resourceShowcase";
}

function isPromotionVariant(data: CTABannerSectionType): data is CtaBannerPromotion {
  return data.variant === "promotion";
}

export function CTABannerSection({ data }: CTABannerSectionProps) {
  const sessionContext = useSession();
  const session = sessionContext?.session;
  
  const isUS = session?.geo?.country_code === 'US' || session?.location?.country_code === 'US';
  const handleLinkClick = useInternalNav();

  // New variants
  if (isStripVariant(data)) {
    return <CtaBannerStripComponent data={data} />;
  }

  if (isResourceShowcaseVariant(data)) {
    return <CtaBannerResourceShowcaseComponent data={data} />;
  }

  if (isPromotionVariant(data)) {
    return <CtaBannerPromotionComponent data={data} />;
  }

  // Form variant: show form on both mobile and desktop
  if (isFormVariant(data)) {
    return (
      <section 
        className="px-4"
        data-testid="section-cta-banner"
      >
        <div className="max-w-5xl mx-auto">
          <div className="flex flex-col lg:flex-row lg:items-center lg:gap-12">
            {/* Left side: Message */}
            <div className="flex-1 text-center lg:text-left mb-6 lg:mb-0 text-primary-foreground">
              <h2 
                className="text-primary-foreground mb-4"
                data-testid="text-cta-banner-title"
              >
                {data.title}
              </h2>
              {data.subtitle && (
                <p 
                  className="text-body opacity-90 max-w-xl mx-auto lg:mx-0" style={{ fontSize: '16px' }}
                  data-testid="text-cta-banner-subtitle"
                >
                  {data.subtitle}
                </p>
              )}
            </div>
            
            {/* Right side: Form */}
            <div 
              className="flex-1 max-w-md mx-auto lg:mx-0 rounded-lg"
              style={data.form_background ? { backgroundColor: data.form_background, padding: '1.5rem' } : undefined}
              data-testid="cta-banner-form"
            >
              {data.form ? (
                <Suspense fallback={<LeadFormFallback />}>
                  <LeadForm
                    data={data.form}
                    termsStyle={data.terms_color ? { color: data.terms_color } : undefined}
                  />
                </Suspense>
              ) : (
                <div className="bg-card/10 backdrop-blur-sm rounded-lg p-6 text-center">
                  <p className="text-primary-foreground/70 text-sm">
                    Lead form configuration required
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }
  
  // Default variant: show buttons on both mobile and desktop
  if (isDefaultVariant(data)) {
    const filteredButtons = data.buttons?.filter((button: CtaButton) => {
      if (button.us_only && !isUS) {
        return false;
      }
      return true;
    });
    
    const hasMultipleButtons = filteredButtons && filteredButtons.length > 0;
    
    return (
      <section 
        className="max-w-6xl mx-auto px-4 text-primary-foreground"
        data-testid="section-cta-banner"
      >
        <div className="max-w-4xl mx-auto text-center">
          {data.title && 
            <h2 
              className="text-primary-foreground mb-4"
              data-testid="text-cta-banner-title"
            >
              {data.title}
            </h2>
          }

          {data.subtitle && (
            <p 
              className="text-body opacity-90 mb-6 max-w-2xl mx-auto" style={{ fontSize: '16px' }}
              data-testid="text-cta-banner-subtitle"
            >
              {data.subtitle}
            </p>
          )}
          
          {hasMultipleButtons ? (
            <div className="flex flex-wrap justify-center gap-4">
              {filteredButtons!.map((button: CtaButton, index: number) => {
                const resolvedVariant = button.button_variant || button.variant;
                const variant = resolvedVariant === "primary" ? "default" : resolvedVariant === "secondary" ? "secondary" : resolvedVariant === "ghost" ? "ghost" : resolvedVariant === "link" ? "link" : resolvedVariant === "destructive" ? "destructive" : resolvedVariant === "outline" ? "outline" : resolvedVariant === "accent" ? "accent" : "default";
                const outlineStyles = resolvedVariant === "outline" ? "border-primary-foreground text-primary-foreground hover:bg-primary-foreground/10" : "";
                const textColorStyle = button.text_color ? { color: button.text_color } : undefined;
                return (
                  <Button
                    key={index}
                    variant={variant as any}
                    size="lg"
                    asChild
                    className={outlineStyles}
                    style={textColorStyle}
                    data-testid={`button-cta-banner-${index}`}
                  >
                    <a href={button.url} onClick={handleLinkClick}>{button.text}</a>
                  </Button>
                );
              })}
            </div>
          ) : data.cta_text && data.cta_url ? (
            <a href={data.cta_url} onClick={handleLinkClick}>
              <Button 
                size="lg" 
                variant="secondary"
                className="font-semibold"
                data-testid="button-cta-banner-action"
              >
                {data.cta_text}
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </a>
          ) : null}
        </div>
      </section>
    );
  }
  
  // Fallback (shouldn't happen with proper typing)
  return null;
}

export default CTABannerSection;
