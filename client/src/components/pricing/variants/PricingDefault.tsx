import { useState } from "react";
import { Award, Flame, School } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RichTextContent } from "@/components/ui/rich-text-content";
import type { PricingSection as PricingSectionType } from "@shared/schema";
import Matplotlib from "@/components/custom-icons/Matplotlib";
import { CSSMarquee } from "@/components/ui/CSSMarquee";
import { getIcon } from "@/lib/icons";
import { getTechBrandIcon } from "@/lib/tech-brand-icons";
import { useInternalNav } from "@/hooks/useInternalNav";

interface PricingSectionProps {
  data: PricingSectionType;
}

function resolveTechIcon(iconName: string) {
  const lower = iconName.toLowerCase();
  if (lower === "matplotlib") return Matplotlib;
  return getTechBrandIcon(iconName);
}

export function PricingSection({ data }: PricingSectionProps) {
  const handleLinkClick = useInternalNav();
  const { i18n } = useTranslation();
  const isSpanish = i18n.language?.startsWith('es');
  const [isYearly, setIsYearly] = useState(true);
  
  const isProductVariant = data.variant === "product";
  
  if (!isProductVariant && (!data.monthly || !data.yearly)) {
    return (
      <section className="bg-muted/30" data-testid="section-pricing">
        <div className="max-w-6xl mx-auto px-4 text-center text-muted-foreground">
          Pricing section requires monthly and yearly pricing data
        </div>
      </section>
    );
  }
  
  const currentPlan = isProductVariant ? null : (isYearly ? data.yearly : data.monthly);
  
  const yearlyLabel = isSpanish ? "Anual" : "Annual";
  const monthlyLabel = isSpanish ? "Mensual" : "Monthly";
  const learnAtPaceText = isSpanish ? "Aprende a tu ritmo" : "Learn at your own pace";

  if (isProductVariant) {
    return (
      <section
        className=""
        data-testid="section-pricing"
      >
        <div className="max-w-6xl mx-auto px-4">
          <div className="mb-6">
            <h2
              className="text-h2 text-primary mb-2"
              data-testid="text-pricing-title"
            >
              {data.title}
            </h2>
            {data.subtitle && (
              <p
                className="text-foreground font-medium"
                data-testid="text-pricing-subtitle"
              >
                {data.subtitle}
              </p>
            )}
          </div>

          <div className="grid lg:grid-cols-12 gap-0 items-stretch relative overflow-hidden">
            <div
              className="relative min-w-0 rounded-t-2xl lg:rounded-tl-2xl lg:rounded-bl-2xl lg:rounded-tr-none lg:rounded-br-none overflow-hidden lg:col-span-4"
              data-testid="card-pricing"
              style={{
                background: "linear-gradient(135deg, #366bff 0%, #4aa5ff 100%)",
              }}
            >

              <div className="flex flex-col items-center justify-between h-full px-4 py-6">
                <div className="flex flex-col items-center justify-center flex-1 py-6 space-y-4">
                  {data.discount_text && (
                    <div className="text-center">
                      {data.discount_text.includes(":") ? (
                        <div data-testid="text-discount">
                          <p className="text-white/90 text-sm">
                            {data.discount_text.split(":")[0]}:
                          </p>
                          <p className="text-white text-sm font-bold mt-1">
                            {data.discount_text.split(":")[1]?.trim()}
                          </p>
                        </div>
                      ) : (
                        <p className="text-white text-sm font-medium" data-testid="text-discount">
                          {data.discount_text}
                        </p>
                      )}
                    </div>
                  )}
                  
                  {data.financing_text && (
                    <div className="text-center">
                      <p className="text-white/90 text-sm" data-testid="text-financing-label">
                        {data.financing_text}
                      </p>
                      {data.financing_amount && (
                        <div className="mt-2">
                          <span
                            className="text-6xl font-bold text-white"
                            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                            data-testid="text-financing-amount"
                          >
                            {data.financing_amount}
                          </span>
                          <span className="text-white text-sm font-normal">{data.financing_period ?? "/mo"}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <Button
                  asChild
                  variant="outline"
                  className="w-full bg-white text-[#061258] border-0 hover:bg-white/90 font-bold h-10 text-[17px] tracking-wide rounded"
                  data-testid="button-get-plan"
                >
                  <a href={data.cta?.url} onClick={handleLinkClick} className="flex items-center justify-center gap-2">
                    <School size={24} className="text-[#061258]" />
                    {data.cta?.text}
                  </a>
                </Button>
              </div>
            </div>

            <div className="min-w-0 bg-background border border-t-0 lg:border-t lg:border-l-0 border-border rounded-b-2xl lg:rounded-b-none lg:rounded-r-2xl p-4 flex flex-col gap-4 lg:col-span-8">
              {data.features_title && (
                <p
                  className="text-[#3A3A3A] font-normal text-body"
                  data-testid="text-features-title"
                >
                  {data.features_title}
                </p>
              )}

              {data.tech_icons && data.tech_icons.length > 0 && (
                <div className="w-full max-w-full overflow-hidden" data-testid="tech-icons">
                  {data.static_icons ? (
                    <div className="flex flex-wrap gap-2">
                      {data.tech_icons.map((iconName, index) => {
                        const IconComponent = resolveTechIcon(iconName);
                        return IconComponent ? (
                          <div
                            key={index}
                            className="flex items-center justify-center px-3 py-2 text-muted-foreground"
                            data-testid={`icon-tech-${index}`}
                          >
                            <IconComponent className="w-5 h-5" title={iconName} />
                          </div>
                        ) : null;
                      })}
                    </div>
                  ) : (
                    <CSSMarquee speed={20} gradient={true} gradientWidth={50} pauseOnHover={true}>
                      {data.tech_icons.map((iconName, index) => {
                        const IconComponent = resolveTechIcon(iconName);
                        return IconComponent ? (
                          <div
                            key={index}
                            className="flex items-center justify-center px-3 py-2 text-muted-foreground"
                            data-testid={`icon-tech-${index}`}
                          >
                            <IconComponent className="w-5 h-5" title={iconName} />
                          </div>
                        ) : null;
                      })}
                    </CSSMarquee>
                  )}
                </div>
              )}

              <div className="border-t border-border" />

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {data.features.map((feature, index) => {
                  const FeatureIcon = feature.icon ? getIcon(feature.icon) : null;
                  
                  return (
                    <div
                      key={index}
                      className="flex items-start gap-2"
                      data-testid={`feature-${index}`}
                    >
                      <div className="flex-shrink-0 mt-0.5">
                        {FeatureIcon ? (
                          <FeatureIcon width="22px" height="22px" size={22} className="text-primary" />
                        ) : (
                          <Award size={22} className="text-primary" />
                        )}
                      </div>
                      <RichTextContent
                        html={feature.text}
                        className="text-[#061258] text-xs leading-relaxed [&_p]:mb-0"
                        data-testid={`text-feature-compact-${index}`}
                      />
                    </div>
                  );
                })}
              </div>

              {(data.footer || (data.footer_badges && data.footer_badges.length > 0)) && (
                <div className="mt-auto" data-testid="footer-badges-section">
                  {data.footer && (
                    <p className="text-xs font-semibold text-muted-foreground tracking-wider mb-2 text-center lg:text-left" data-testid="text-footer-label">
                      {data.footer}
                    </p>
                  )}
                  {data.footer_badges && data.footer_badges.length > 0 && (
                    <div className="flex flex-wrap gap-2 justify-center lg:justify-start">
                      {data.footer_badges.map((item, index) => (
                        <span
                          key={index}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs text-foreground bg-muted"
                          data-testid={`badge-footer-${index}`}
                        >
                          <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                          {item.label}
                          {item.tag && (
                            <span
                              className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                              data-testid={`badge-footer-tag-${index}`}
                            >
                              {item.tag}
                            </span>
                          )}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="bg-gradient-to-r from-[#e8f4fc] to-white dark:from-muted/30 dark:to-background"
      data-testid="section-pricing"
    >
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
          <h2
            className="text-h2 text-primary"
            data-testid="text-pricing-title"
          >
            {data.title}
          </h2>
          <div
            className="inline-flex rounded-full border border-primary/20 p-1 bg-background"
            data-testid="toggle-billing-period"
          >
            <button
              onClick={() => setIsYearly(true)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isYearly
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-yearly"
            >
              {yearlyLabel}
            </button>
            <button
              onClick={() => setIsYearly(false)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                !isYearly
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              data-testid="button-monthly"
            >
              {monthlyLabel}
            </button>
          </div>
        </div>
        {data.subtitle && (
          <p
            className="text-foreground font-medium mb-6"
            data-testid="text-pricing-subtitle"
          >
            {data.subtitle}
          </p>
        )}

        <div className="grid lg:grid-cols-12 gap-0 items-stretch relative overflow-hidden">
          <div
            className="flex items-center absolute -top-4 left-0 z-10"
            data-testid="badge-discount"
          >
            <div className="flex items-center justify-center p-1.5 bg-[#BE0000] border-2 border-[#EB5757] rounded-full z-10">
              <Flame size={28} className="text-[#FFB718]" style={{ filter: 'drop-shadow(0 0 4px rgba(255, 183, 24, 0.5))' }} />
            </div>
            <div className="flex items-center justify-center bg-[#EB5757] rounded-full px-3 py-1 -ml-2">
              <span className="text-[#FFBEBE] text-sm font-normal">
                {currentPlan?.discount_badge}
              </span>
            </div>
          </div>

          <div
            className="relative min-w-0 rounded-t-2xl lg:rounded-t-none lg:rounded-l-2xl overflow-hidden lg:col-span-4"
            style={{
              background: "linear-gradient(135deg, #66B8FF 0%, #3399FF 100%)",
            }}
            data-testid="card-pricing"
          >
            <div className="flex flex-col items-center justify-between h-full px-4 py-6 pt-12">
              <div className="flex items-center gap-2 w-full">
                <span className="text-white text-sm flex-1">{learnAtPaceText}</span>
                <Badge
                  className="bg-[#0062BD] border border-[#FAFDFF] text-[#FAFDFF] text-xs font-bold px-2.5 py-1 rounded-full"
                  data-testid="badge-period"
                >
                  {isYearly ? yearlyLabel : monthlyLabel}
                </Badge>
              </div>

              <div className="flex flex-col items-center justify-center flex-1 py-6">
                <div className="text-center">
                  <span
                    className="text-h1 text-white"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                    data-testid="text-price"
                  >
                    ${currentPlan?.price}
                  </span>
                  <span className="text-white text-xs font-normal">/{currentPlan?.period}</span>
                </div>

                {currentPlan?.original_price && (
                  <div
                    className="text-white/60 line-through text-body mt-1"
                    data-testid="text-original-price"
                  >
                    ${currentPlan.original_price}
                  </div>
                )}

                {currentPlan?.savings_badge && (
                  <Badge
                    className="bg-[#061258] text-white border-0 mt-2 text-xs"
                    data-testid="badge-savings"
                  >
                    {currentPlan.savings_badge}
                  </Badge>
                )}
              </div>

              <Button
                asChild
                variant="outline"
                className="w-full bg-white text-[#061258] border-0 hover:bg-white/90 font-bold h-10 text-[17px] tracking-wide rounded"
                data-testid="button-get-plan"
              >
                <a href={data.cta?.url} onClick={handleLinkClick} className="flex items-center justify-center gap-2">
                  <School size={24} className="text-[#061258]" />
                  {data.cta?.text}
                </a>
              </Button>
            </div>
          </div>

          <div className="min-w-0 bg-background border border-t-0 lg:border-t lg:border-l-0 border-border rounded-b-2xl lg:rounded-b-none lg:rounded-r-2xl p-4 space-y-4 lg:col-span-8 overflow-hidden">
            {data.features_title && (
              <p
                className="text-[#3A3A3A] font-normal text-lg"
                data-testid="text-features-title"
              >
                {data.features_title}
              </p>
            )}

            {data.tech_icons && data.tech_icons.length > 0 && (
              <div className="w-full max-w-full overflow-hidden" data-testid="tech-icons">
                {data.static_icons ? (
                  <div className="flex flex-wrap gap-2">
                    {data.tech_icons.map((iconName, index) => {
                      const IconComponent = resolveTechIcon(iconName);
                      return IconComponent ? (
                        <div
                          key={index}
                          className="flex items-center justify-center px-3 py-2 text-muted-foreground"
                          data-testid={`icon-tech-${index}`}
                        >
                          <IconComponent className="w-5 h-5" title={iconName} />
                        </div>
                      ) : null;
                    })}
                  </div>
                ) : (
                  <CSSMarquee speed={20} gradient={true} gradientWidth={50} pauseOnHover={true}>
                    {data.tech_icons.map((iconName, index) => {
                      const IconComponent = resolveTechIcon(iconName);
                      return IconComponent ? (
                        <div
                          key={index}
                          className="flex items-center justify-center px-3 py-2 text-muted-foreground"
                          data-testid={`icon-tech-${index}`}
                        >
                          <IconComponent className="w-5 h-5" title={iconName} />
                        </div>
                      ) : null;
                    })}
                  </CSSMarquee>
                )}
              </div>
            )}

            <div className="border-t border-border" />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {data.features.map((feature, index) => {
                const IconComponent = feature.icon ? getIcon(feature.icon) : null;
                
                return (
                  <div
                    key={index}
                    className="flex items-start gap-2"
                    data-testid={`feature-${index}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {IconComponent ? (
                        <IconComponent width="22px" height="22px" size={22} className="text-primary" />
                      ) : (
                        <Award size={22} className="text-primary" />
                      )}
                    </div>
                    <RichTextContent
                      html={feature.text}
                      className="text-[#061258] text-xs leading-relaxed [&_p]:mb-0"
                      data-testid={`text-feature-${index}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default PricingSection;
