// section-spacing: self-padded
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { WhyLearnAISection as WhyLearnAISectionType } from "@shared/schema";
import { RichTextContent } from "@/components/ui/rich-text-content";
import UniversalImage from "@/components/UniversalImage";
import { useInternalNav } from "@/hooks/useInternalNav";

const DEFAULT_LAPTOP_IMAGE_ID = "laptop";

const MOBILE_CHAR_LIMIT = 150;

function truncateAtWordBoundary(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const truncated = text.slice(0, limit);
  const lastSpaceIndex = truncated.lastIndexOf(' ');
  if (lastSpaceIndex === -1) return truncated;
  return truncated.slice(0, lastSpaceIndex);
}

interface WhyLearnAILaptopEdgeProps {
  data: WhyLearnAISectionType;
}

export default function WhyLearnAILaptopEdge({ data }: WhyLearnAILaptopEdgeProps) {
  const laptopImageId = data.laptop_image?.image_id ?? DEFAULT_LAPTOP_IMAGE_ID;
  const handleLinkClick = useInternalNav();
  const [isExpanded, setIsExpanded] = useState(false);
  const description = data.description || "";
  const showSeeMore = data.mobile_see_more === true;
  const seeMoreLabel = data.mobile_see_more_label || "See more";
  const seeLessLabel = data.mobile_see_less_label || "See less";

  return (
    <section 
      className="relative overflow-hidden"
      data-testid="section-why-learn-ai"
    >
      {/* Background - hidden on mobile */}
      <div className="hidden md:block">
        <div 
          className="absolute right-0 top-0 bottom-0 w-[19%] bg-primary/10 rounded-lg"
          aria-hidden="true"
        />
      </div>
      
      {/* Mobile full bg */}
      <div className="md:hidden absolute inset-0 bg-muted" aria-hidden="true" />

      {/* ===== MOBILE LAYOUT ===== */}
      <div className="md:hidden relative px-4 py-8">
        <h2 
          className="text-2xl font-bold mb-3 text-foreground"
          data-testid="text-why-learn-title-mobile"
        >
          {data.title}
        </h2>

        <h3 
          className="text-base font-bold mb-4 text-primary"
          data-testid="text-why-learn-subtitle-mobile"
        >
          {data.subtitle}
        </h3>

        <div 
          className="text-sm text-muted-foreground mb-6 leading-relaxed"
          data-testid="text-why-learn-description-mobile"
        >
          {showSeeMore && description.length > MOBILE_CHAR_LIMIT && !isExpanded ? (
            <>
              <RichTextContent
                html={truncateAtWordBoundary(description, MOBILE_CHAR_LIMIT) + "..."}
                className="text-sm text-muted-foreground inline"
              />
              {' '}
              <button
                onClick={() => setIsExpanded(true)}
                className="text-sm font-medium text-primary underline"
                data-testid="button-see-more"
              >
                {seeMoreLabel}
              </button>
            </>
          ) : (
            <>
              <RichTextContent
                html={description}
                className="text-sm text-muted-foreground"
              />
              {showSeeMore && description.length > MOBILE_CHAR_LIMIT && isExpanded && (
                <button
                  onClick={() => setIsExpanded(false)}
                  className="text-sm font-medium text-primary underline mt-1"
                  data-testid="button-see-less"
                >
                  {seeLessLabel}
                </button>
              )}
            </>
          )}
        </div>

        {data.cta && (
          <Button
            variant={data.cta.variant === "primary" ? "default" : data.cta.variant === "outline" ? "outline" : data.cta.variant === "accent" ? "accent" : "secondary"}
            asChild
            className="mb-6"
            data-testid="button-why-learn-cta-mobile"
          >
            <a href={data.cta.url} onClick={handleLinkClick}>{data.cta.text}</a>
          </Button>
        )}

        {/* Laptop image centered below content */}
        <div className="flex justify-center">
          <UniversalImage
            id={laptopImageId}
            alt={data.laptop_image?.alt ?? "Code editor on laptop"}
            className="w-[90%] max-w-[400px] h-auto object-contain"
            loading="lazy"
            data-testid="img-why-learn-ai-mobile"
            fieldContext={{ fieldPath: "laptop_image.image_id" }}
          />
        </div>
      </div>

      {/* ===== DESKTOP LAYOUT ===== */}
      <div className="hidden md:block relative max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-9 gap-8 items-center py-16">
          <div className="col-span-7 max-w-full">
            <h2 
              className="text-h2 mb-4 text-foreground"
              data-testid="text-why-learn-title"
            >
              {data.title}
            </h2>

            <h3 
              className="text-body font-bold mb-6 text-primary"
              data-testid="text-why-learn-subtitle"
            >
              {data.subtitle}
            </h3>

            <RichTextContent
              html={data.description || ""}
              className="text-body text-muted-foreground mb-8 lg:me-4 leading-relaxed"
              data-testid="text-why-learn-description"
            />

            {data.cta && (
              <Button
                variant={data.cta.variant === "primary" ? "default" : data.cta.variant === "outline" ? "outline" : data.cta.variant === "accent" ? "accent" : "secondary"}
                asChild
                data-testid="button-why-learn-cta"
              >
                <a href={data.cta.url} onClick={handleLinkClick}>{data.cta.text}</a>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Laptop image - hidden on mobile only, visible from md */}
      <div className="hidden md:flex absolute md:right-[-480px] lg:right-[-400px] xl:right-[-307px] top-0 bottom-0 w-[700px] items-center pointer-events-none">
        <UniversalImage
          id={laptopImageId}
          alt={data.laptop_image?.alt ?? "Code editor on laptop"}
          className="w-full h-[90%] object-contain object-left"
          loading="lazy"
          data-testid="img-why-learn-ai"
          fieldContext={{ fieldPath: "laptop_image.image_id" }}
        />
      </div>
    </section>
  );
}
