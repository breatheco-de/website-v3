import { useState } from "react";
import type { BannerSection as BannerSectionType } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { useInternalNav } from "@/hooks/useInternalNav";
import UniversalImage from "@/components/UniversalImage";

const MOBILE_CHAR_LIMIT = 150;
const DEFAULT_LOGO_ID = "rigo-avatar-1763181725290";

function truncateAtWordBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit);
  const lastSpaceIndex = truncated.lastIndexOf(' ');
  if (lastSpaceIndex === -1) return truncated;
  return truncated.slice(0, lastSpaceIndex);
}

interface BannerProps {
  data: BannerSectionType;
}

const CARD_BACKGROUND = {
  background: "linear-gradient(135deg, #366bff 0%, #4aa5ff 100%)",
};

export function Banner({ data }: BannerProps) {
  const { logo, avatars, title, description, cta } = data;
  const [isExpanded, setIsExpanded] = useState(false);
  const handleLinkClick = useInternalNav();

  const renderAvatars = () => {
    const hasLogo = !!logo;
    const hasAvatars = avatars && avatars.length > 0;
    
    if (!hasLogo && !hasAvatars) return null;

    const totalItems = (hasLogo ? 1 : 0) + (avatars?.length || 0);

    return (
      <div 
        className="flex justify-center -mt-14 mb-6"
        data-testid="banner-avatars"
      >
        <div className="flex -space-x-3">
          {hasLogo && (
            <div
              className="w-14 h-14 rounded-full border-4 border-white overflow-hidden flex items-center justify-center"
              style={{ 
                backgroundColor: "hsl(var(--primary))",
                zIndex: totalItems,
              }}
              data-testid="banner-logo"
            >
              <UniversalImage
                id={typeof logo === "string" && logo.length > 0 ? logo : DEFAULT_LOGO_ID}
                alt="Logo"
                className="w-9 h-9"
                style={{ objectFit: "contain" }}
                fieldContext={{ fieldPath: "logo" }}
              />
            </div>
          )}
          {avatars?.map((avatarValue, index) => (
            <div
              key={index}
              className="w-14 h-14 rounded-full border-4 border-white overflow-hidden flex items-center justify-center bg-muted"
              style={{ zIndex: totalItems - index - (hasLogo ? 1 : 0) }}
              data-testid={`banner-avatar-${index}`}
            >
              <UniversalImage
                id={avatarValue}
                alt=""
                className="w-full h-full"
                style={{ objectFit: "cover" }}
                fieldContext={{ arrayPath: "avatars", index }}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <section 
      className="py-12 md:py-16"
      data-testid="section-banner"
    >
      <div className="max-w-6xl mx-auto px-4">
        <div 
          className="relative rounded-[0.8rem] px-6 pt-10 pb-12 md:px-12 md:pt-10 md:pb-16 text-center"
          style={CARD_BACKGROUND}
          data-testid="banner-container"
        >
          {renderAvatars()}

          <h2 
            className="font-bold mb-4 text-white text-[30px] lg:text-[44px]"
            data-testid="text-banner-title"
          >
            {title}
          </h2>

          {description && (
            <>
              {/* Mobile: truncated with see more/less */}
              <p 
                className="md:hidden mx-auto text-white/85 text-[16px]"
                data-testid="text-banner-description-mobile"
              >
                {description.length > MOBILE_CHAR_LIMIT && !isExpanded ? (
                  <>
                    {truncateAtWordBoundary(description, MOBILE_CHAR_LIMIT)}...{' '}
                    <button
                      onClick={() => setIsExpanded(true)}
                      className="text-sm font-medium text-white underline"
                      data-testid="button-see-more"
                    >
                      see more
                    </button>
                  </>
                ) : (
                  <>
                    {description}
                    {description.length > MOBILE_CHAR_LIMIT && (
                      <>
                        {' '}
                        <button
                          onClick={() => setIsExpanded(false)}
                          className="text-sm font-medium text-white underline"
                          data-testid="button-see-less"
                        >
                          see less
                        </button>
                      </>
                    )}
                  </>
                )}
              </p>
              {/* Desktop: full text */}
              <p 
                className="hidden md:block mx-auto lg:mb-8 text-white/85 text-[20px] lg:text-[26px]"
                data-testid="text-banner-description"
              >
                {description}
              </p>
            </>
          )}

          {cta && (
            <Button
              variant={cta.variant === "outline" ? "outline" : "secondary"}
              size="lg"
              asChild
              className={cta.variant === "outline" ? "border-white text-white hover:bg-white/10" : ""}
              data-testid="button-banner-cta"
            >
              <a href={cta.url} onClick={handleLinkClick}>{cta.text}</a>
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

export default Banner;
