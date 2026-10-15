import { useState, useEffect, createElement } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown } from "lucide-react";
import type { 
  AiLearningSection as AILearningSectionType,
  AiLearningFeatureTabsSection,
  AiLearningHighlightSection,
} from "@shared/schema";
import { cn } from "@/lib/utils";
import { getIcon } from "@/lib/icons";
import UniversalImage from "@/components/UniversalImage";
import { UniversalVideo } from "@/components/UniversalVideo";
import { useInternalNav } from "@/hooks/useInternalNav";

interface AILearningSectionProps {
  data: AILearningSectionType;
}

interface FeatureBullet {
  text: string;
  icon?: string;
}

interface VideoConfig {
  url: string;
  ratio?: string;
  muted?: boolean;
  autoplay?: boolean;
  loop?: boolean;
  preview_image_url?: string;
  with_shadow_border?: boolean;
}

interface Feature {
  icon: string;
  title: string;
  description: string;
  show_rigobot_logo?: boolean;
  bullets?: FeatureBullet[];
  /** @deprecated Use video.url instead */
  video_url?: string;
  video?: VideoConfig;
  image_id?: string;
  cta?: {
    text: string;
    url: string;
    variant?: string;
  };
}

interface HoverFeatureCardProps {
  feature: Feature;
  index: number;
  isSelected: boolean;
  isHovering: boolean;
  onHover: () => void;
  onLeave: () => void;
  showRigobotLogo: boolean;
  renderIcon: (iconName: string, isRigobot?: boolean) => JSX.Element | null;
}

function HoverFeatureCard({ feature, index, isSelected, isHovering, onHover, onLeave, showRigobotLogo, renderIcon }: HoverFeatureCardProps) {
  const isActive = isSelected || isHovering;
  
  return (
    <Card 
      className={cn(
        "shadow-none cursor-pointer transition-all duration-300 ease-out",
        "border-2 md:border-0",
        isSelected
          ? "scale-[1.04] md:scale-[1.08] border-primary bg-primary/5"
          : "scale-100 border-transparent bg-[#f0f0f04d] dark:bg-[#ffffff0d]"
      )}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      data-testid={`feature-ai-${index}`}
    >
      <CardContent className="!p-3 !md:p-6">
        <div className="flex items-center gap-2 md:gap-3">
          <div className={cn(
            "w-8 h-8 md:w-10 md:h-10 rounded-md flex items-center justify-center flex-shrink-0 transition-colors",
            isActive ? "bg-primary/20" : "bg-primary/10"
          )}>
            {renderIcon(feature.icon, false)}
          </div>
          <h3 className="font-semibold text-foreground flex-1 text-sm md:text-base">
            {feature.title}
          </h3>
        </div>
      </CardContent>
    </Card>
  );
}

function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function renderSectionIcon(iconName: string, isRigobot: boolean = false, isLarge: boolean = false) {
  if (isRigobot) {
    return (
      <UniversalImage
        id="rigobot-logo-1764707022198"
        alt="Rigobot"
        className={isLarge ? "w-full h-full" : "w-7 h-7"}
        style={{ objectFit: isLarge ? "cover" : "contain" }}
      />
    );
  }
  const IconComponent = getIcon(iconName);
  if (!IconComponent) return null;
  return createElement(IconComponent, {
    size: isLarge ? 32 : 24,
    className: "text-primary",
  });
}

// Type guard for feature-tabs variant
function isFeatureTabsVariant(data: AILearningSectionType): data is AiLearningFeatureTabsSection {
  return !('variant' in data) || data.variant !== 'highlight';
}

// Type guard for highlight variant
function isHighlightVariant(data: AILearningSectionType): data is AiLearningHighlightSection {
  return 'variant' in data && data.variant === 'highlight';
}

// Feature Tabs Variant Component
function AILearningFeatureTabs({ data }: { data: AiLearningFeatureTabsSection }) {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [showAllBullets, setShowAllBullets] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const features = data.features || [];
  const displayedFeature = features[selectedIndex];

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleLinkClick = useInternalNav();
  const videoId = data.video_url ? extractYouTubeId(data.video_url) : null;

  return (
    <section 
      className=""
      data-testid="section-ai-learning"
    >
      <div className="max-w-6xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 
            className="text-h2 mb-4 text-foreground"
            data-testid="text-ai-title"
          >
            {data.title}
          </h2>
          
          <p 
            className="text-body text-muted-foreground max-w-3xl mx-auto"
            data-testid="text-ai-description"
          >
            {data.description}
          </p>
        </div>

        {/* Hover Feature Cards */}
        <div className="grid md:grid-cols-3 gap-3 md:gap-6 mb-8">
          {features.slice(0, 3).map((feature: Feature, index: number) => {
            const showRigobotLogo = feature.show_rigobot_logo ?? feature.title?.toLowerCase().includes('rigobot') ?? false;
            return (
              <HoverFeatureCard
                key={index}
                feature={feature}
                index={index}
                isSelected={selectedIndex === index}
                isHovering={hoverIndex === index}
                onHover={() => {
                  setHoverIndex(index);
                  setSelectedIndex(index);
                  setShowAllBullets(false);
                }}
                onLeave={() => {
                  setHoverIndex(null);
                }}
                showRigobotLogo={showRigobotLogo}
                renderIcon={renderSectionIcon}
              />
            );
          })}
        </div>

        {/* Displayed Feature Content */}
        {displayedFeature && (
          <Card 
            className="border-0 shadow-card mb-16 transition-all duration-300"
            data-testid="selected-feature-content"
          >
            <CardContent className="px-2 pb-6 pt-0 md:p-8">
              <div className="flex flex-col md:grid md:grid-cols-2 gap-8 items-center">
                {/* Media - shows first on mobile, second on tablet/desktop */}
                <div className="order-1 md:order-2 w-full">
                  {displayedFeature.image_id ? (
                    <div data-testid="image-container-feature">
                      <UniversalImage
                        id={displayedFeature.image_id}
                        preset="card-wide"
                        className="aspect-video"
                        bordered={true}
                        fieldContext={{ arrayPath: "features", index: selectedIndex, srcField: "image_id" }}
                      />
                    </div>
                  ) : (displayedFeature.video?.url || displayedFeature.video_url) ? (
                    <div data-testid="video-container-feature">
                      <UniversalVideo
                        url={displayedFeature.video?.url || displayedFeature.video_url!}
                        autoplay={displayedFeature.video?.autoplay === true}
                        loop={displayedFeature.video?.loop ?? (displayedFeature.video?.url || displayedFeature.video_url || '').includes('.mp4')}
                        muted={displayedFeature.video?.muted ?? (displayedFeature.video?.url || displayedFeature.video_url || '').includes('.mp4')}
                        bordered={displayedFeature.video?.with_shadow_border ?? true}
                        ratio={displayedFeature.video?.ratio}
                        preview_image_url={displayedFeature.video?.preview_image_url}
                        open_modal_on_click={displayedFeature.video?.open_modal_on_click}
                        overlay_on_muted={displayedFeature.video?.overlay_on_muted}
                      />
                    </div>
                  ) : videoId ? (
                    <div data-testid="video-container-ai">
                      <UniversalVideo
                        url={data.video?.url || data.video_url!}
                        autoplay={data.video?.autoplay}
                        loop={data.video?.loop}
                        muted={data.video?.muted}
                        bordered={data.video?.with_shadow_border ?? true}
                        ratio={data.video?.ratio}
                        preview_image_url={data.video?.preview_image_url}
                        open_modal_on_click={data.video?.open_modal_on_click}
                        overlay_on_muted={data.video?.overlay_on_muted}
                      />
                    </div>
                  ) : null}
                </div>

                {/* Text content - shows second on mobile, first on tablet/desktop */}
                <div className="order-2 md:order-1">
                  {/* Title and icon - hidden on mobile */}
                  <div className="hidden md:flex items-start gap-4 mb-6">
                    <div className="flex-shrink-0 w-12 h-12 rounded-full overflow-hidden">
                      {renderSectionIcon(displayedFeature.icon, displayedFeature.show_rigobot_logo ?? displayedFeature.title?.toLowerCase().includes('rigobot'), true)}
                    </div>
                    <h3 className="text-h2 text-foreground">
                      {displayedFeature.title}
                    </h3>
                  </div>
                  
                  {/* Description - hidden on mobile */}
                  {displayedFeature.description && (
                    <p className="hidden md:block text-muted-foreground text-body leading-relaxed mb-4">
                      {displayedFeature.description}
                    </p>
                  )}
                  
                  {displayedFeature.bullets && displayedFeature.bullets.length > 0 && (
                    <>
                      <ul className="space-y-3 mb-3" data-testid="feature-bullets">
                        {displayedFeature.bullets
                          .slice(0, (!isMobile || showAllBullets) ? undefined : 2)
                          .map((bullet: FeatureBullet, idx: number) => (
                          <li key={idx} className="flex items-start gap-3">
                            <span className="text-primary flex-shrink-0 mt-0.5">
                              {bullet.icon ? renderSectionIcon(bullet.icon) : <Check size={20} />}
                            </span>
                            <span className="text-muted-foreground">{bullet.text}</span>
                          </li>
                        ))}
                      </ul>
                      {isMobile && displayedFeature.bullets.length > 2 && !showAllBullets && (
                        <button
                          onClick={() => setShowAllBullets(true)}
                          className="text-primary text-sm font-medium mb-3 flex items-center gap-1 mb-4"
                          data-testid="button-see-more-bullets"
                        >
                          See more <ChevronDown size={16} />
                        </button>
                      )}
                      <div className="mb-3" />
                    </>
                  )}
                  
                  {displayedFeature.cta && (
                    <Button
                      variant={displayedFeature.cta.variant === "primary" ? "default" : displayedFeature.cta.variant === "outline" ? "outline" : "secondary"}
                      asChild
                      data-testid="button-feature-cta"
                    >
                      <a href={displayedFeature.cta.url} onClick={handleLinkClick}>{displayedFeature.cta.text}</a>
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}

// Highlight Variant Component
function AILearningHighlight({ data }: { data: AiLearningHighlightSection }) {
  const handleLinkClick = useInternalNav();
  const videoUrl = data.video?.url || data.video_url;
  const hasVideo = !!videoUrl;

  return (
    <section 
      className=""
      data-testid="section-ai-learning-highlight"
    >
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          <div data-testid="highlight-block" className={data.video_position === "left" ? "lg:order-2" : ""}>
            <div className="flex items-start gap-4 mb-6">
              <div className="flex-shrink-0 w-12 h-12 rounded-full overflow-hidden">
                <UniversalImage
                  id="rigobot-logo-1764707022198"
                  alt="Rigobot"
                  className="w-full h-full"
                  style={{ objectFit: "cover" }}
                />
              </div>
              <div>
                <h3 
                  className="text-h2 text-foreground mb-2"
                  data-testid="text-highlight-title"
                >
                  {data.title}
                </h3>
              </div>
            </div>
            
            <p 
              className="mb-6 text-muted-foreground text-body"
              data-testid="text-highlight-description"
            >
              {data.description}
            </p>

            {data.bullets && data.bullets.length > 0 && (
              <div className="flex flex-col justify-center gap-3 mb-6" data-testid="highlight-bullets">
                {data.bullets.map((bullet: FeatureBullet, idx: number) => (
                  <div key={idx} className="flex items-center gap-3 ">
                    <div className="flex items-center gap-2">
                      <span className="text-primary flex-shrink-0">
                        {bullet.icon ? renderSectionIcon(bullet.icon) : <Check size={20} />}
                      </span>
                      <span className="text-muted-foreground">{bullet.text}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {data.cta && (
              <Button
                variant={data.cta.variant === "primary" ? "default" : data.cta.variant === "outline" ? "outline" : "secondary"}
                asChild
                data-testid="button-highlight-cta"
              >
                <a href={data.cta.url} onClick={handleLinkClick}>{data.cta.text}</a>
              </Button>
            )}
          </div>
          
          {hasVideo && (
            <div 
              className={data.video_position === "left" ? "lg:order-1" : ""}
              data-testid="video-container-highlight"
            >
              <UniversalVideo
                url={videoUrl!}
                autoplay={data.video?.autoplay}
                loop={data.video?.loop}
                muted={data.video?.muted}
                bordered={data.video?.with_shadow_border ?? true}
                ratio={data.video?.ratio}
                preview_image_url={data.video?.preview_image_url}
                open_modal_on_click={data.video?.open_modal_on_click}
                overlay_on_muted={data.video?.overlay_on_muted}
              />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// Main component that routes to the correct variant
export function AILearningSection({ data }: AILearningSectionProps) {
  if (isHighlightVariant(data)) {
    return <AILearningHighlight data={data} />;
  }
  
  // Default to feature-tabs variant
  if (isFeatureTabsVariant(data)) {
    return <AILearningFeatureTabs data={data} />;
  }
  
  return null;
}

export default AILearningSection;
