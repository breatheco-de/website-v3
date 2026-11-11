
import { Button } from "@/components/ui/button";
import type { WhyLearnAISection as WhyLearnAISectionType } from "@shared/schema";
import { useImageRegistry } from "@/components/UniversalImage";
import { useInternalNav } from "@/hooks/useInternalNav";
import { RichTextContent } from "@/components/ui/rich-text-content";

interface WhyLearnAIDefaultProps {
  data: WhyLearnAISectionType;
}

export default function WhyLearnAIDefault({ data }: WhyLearnAIDefaultProps) {
  const handleLinkClick = useInternalNav();
  const { registry } = useImageRegistry();
  const manWithLaptop = registry?.images?.["man-with-laptop-1764772912948"]?.src;
  return (
    <section 
      className="bg-gradient-to-r from-muted/50 to-background dark:from-muted/30 dark:to-background"
      data-testid="section-why-learn-ai"
    >
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div>
            <h2 
              className="text-h2 mb-4 text-foreground"
              data-testid="text-why-learn-title"
            >
              {data.title}
            </h2>
            
            <h3 
              className="text-body font-bold mb-6 text-foreground"
              data-testid="text-why-learn-subtitle"
            >
              {data.subtitle}
            </h3>

            <RichTextContent
                html={data.description}
                className="text-body text-muted-foreground mb-8 leading-relaxed"
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
          
          <div className="flex justify-center lg:justify-end">
            {manWithLaptop && (
              <img 
                src={manWithLaptop}
                alt="Developer coding with AI"
                className="max-w-full h-auto max-h-[400px] object-contain"
                loading="lazy"
                data-testid="img-why-learn-ai"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
