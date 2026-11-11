import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import type { TwoColumnSection as TwoColumnSectionType, TwoColumnColumn, BenefitItem, VideoConfig } from "@shared/schema";
import type { CSSProperties } from "react";
import { getIcon } from "@/lib/icons";
import { UniversalVideo } from "@/components/UniversalVideo";
import { UniversalImage } from "@/components/UniversalImage";
import { useInternalNav } from "@/hooks/useInternalNav";
import { RichTextContent } from "@/components/ui/rich-text-content";

export type { TwoColumnSectionType };

type ColumnVideoInput = string | VideoConfig | undefined;

/** Accepts legacy string URL + flat column fields, or full video config object. */
function normalizeColumnVideo(
  video: ColumnVideoInput,
  videoRatio?: string,
  videoPreviewImage?: string,
  videoWidth?: string,
): VideoConfig | null {
  if (!video) return null;
  if (typeof video === "string") {
    const url = video.trim();
    if (!url || url === "null" || url === "undefined" || /\{\{.*\}\}/.test(url)) return null;
    return {
      url,
      ratio: videoRatio,
      preview_image_url: videoPreviewImage,
      width: videoWidth,
    };
  }
  const url = video.url?.trim();
  if (!url || url === "null" || url === "undefined" || /\{\{.*\}\}/.test(url)) return null;
  return {
    ...video,
    url,
    ratio: video.ratio || videoRatio,
    preview_image_url: video.preview_image_url || videoPreviewImage,
    width: video.width || videoWidth,
  };
}

function ColumnVideo({
  video,
  videoRatio,
  videoPreviewImage,
  videoWidth,
  justify,
  wrapperClassName,
  innerClassName,
}: {
  video: ColumnVideoInput;
  videoRatio?: string;
  videoPreviewImage?: string;
  videoWidth?: string;
  justify?: "start" | "center" | "end";
  wrapperClassName?: string;
  innerClassName?: string;
}) {
  const config = normalizeColumnVideo(video, videoRatio, videoPreviewImage, videoWidth);
  if (!config?.url) return null;
  const width = config.width || "100%";
  return (
    <div className={wrapperClassName ?? `w-full flex ${getJustifyClass(justify)}`}>
      <div className={innerClassName} style={{ width, maxWidth: "100%" }}>
        <UniversalVideo
          url={config.url}
          ratio={config.ratio || "16:9"}
          mobileRatio={config.mobile_ratio}
          preview_image_url={config.preview_image_url}
          autoplay={config.autoplay === true}
          muted={config.muted !== false}
          loop={config.loop !== false}
          open_modal_on_click={config.open_modal_on_click}
          show_controls_on_autoplay={config.show_controls_on_autoplay === true}
          overlay_on_muted={config.overlay_on_muted}
        />
      </div>
    </div>
  );
}

interface TwoColumnProps {
  data: TwoColumnSectionType;
}

const renderIcon = (iconName: string, className?: string) => {
  const IconComponent = getIcon(iconName);
  return IconComponent ? <IconComponent className={className} size={20} /> : null;
};

const getGridColClass = (proportion: number): string => {
  const colMap: Record<number, string> = {
    1: "md:col-span-1",
    2: "md:col-span-2",
    3: "md:col-span-3",
    4: "md:col-span-4",
    5: "md:col-span-5",
    6: "md:col-span-6",
    7: "md:col-span-7",
    8: "md:col-span-8",
    9: "md:col-span-9",
    10: "md:col-span-10",
    11: "md:col-span-11",
    12: "md:col-span-12",
  };
  return colMap[proportion] || "md:col-span-6";
};

const getAlignmentClass = (alignment?: "start" | "center" | "end"): string => {
  switch (alignment) {
    case "start": return "items-start";
    case "end": return "items-end";
    case "center":
    default: return "items-center";
  }
};

const getJustifyClass = (justify?: "start" | "center" | "end"): string => {
  switch (justify) {
    case "start": return "justify-start";
    case "end": return "justify-end";
    case "center":
    default: return "justify-center";
  }
};

const getResponsiveJustifyClass = (justify?: "start" | "center" | "end"): string => {
  switch (justify) {
    case "start": return "justify-center md:justify-start";
    case "end": return "justify-center md:justify-end";
    case "center":
    default: return "justify-center";
  }
};

const gapMap: Record<string, string> = {
  "0": "gap-0", "1": "gap-1", "2": "gap-2", "3": "gap-3", "4": "gap-4",
  "5": "gap-5", "6": "gap-6", "7": "gap-7", "8": "gap-8", "9": "gap-9",
  "10": "gap-10", "11": "gap-11", "12": "gap-12", "14": "gap-14", "16": "gap-16",
  "20": "gap-20", "24": "gap-24", "28": "gap-28", "32": "gap-32", "36": "gap-36",
  "40": "gap-40", "44": "gap-44", "48": "gap-48", "52": "gap-52", "56": "gap-56",
  "60": "gap-60", "64": "gap-64", "72": "gap-72", "80": "gap-80", "96": "gap-96",
};

const getGapClass = (gap?: string): string => {
  return gap ? (gapMap[gap] || "gap-4") : "gap-4";
};

const getTextAlignClass = (textAlign?: "left" | "center" | "right"): string => {
  switch (textAlign) {
    case "center": return "text-center";
    case "right": return "text-right";
    case "left":
    default: return "text-left";
  }
};

const getTextFontSize = (size?: string): string => {
  const sizeMap: Record<string, string> = {
    "xs": "text-xs",
    "sm": "text-sm",
    "base": "text-base",
    "lg": "text-body",
    "xl": "text-body",
    "2xl": "text-h2",
    "3xl": "text-h2",
    "4xl": "text-h1",
    "5xl": "text-h1",
  };
  return size ? (sizeMap[size] || "text-body") : "text-body";
};

const paddingLeftMap: Record<string, string> = {
  "0": "md:pl-0", "1": "md:pl-1", "2": "md:pl-2", "3": "md:pl-3", "4": "md:pl-4",
  "5": "md:pl-5", "6": "md:pl-6", "7": "md:pl-7", "8": "md:pl-8", "9": "md:pl-9",
  "10": "md:pl-10", "11": "md:pl-11", "12": "md:pl-12", "14": "md:pl-14", "16": "md:pl-16",
  "20": "md:pl-20", "24": "md:pl-24", "28": "md:pl-28", "32": "md:pl-32", "36": "md:pl-36",
  "40": "md:pl-40", "44": "md:pl-44", "48": "md:pl-48", "52": "md:pl-52", "56": "md:pl-56",
  "60": "md:pl-60", "64": "md:pl-64", "72": "md:pl-72", "80": "md:pl-80", "96": "md:pl-96",
};

const paddingRightMap: Record<string, string> = {
  "0": "md:pr-0", "1": "md:pr-1", "2": "md:pr-2", "3": "md:pr-3", "4": "md:pr-4",
  "5": "md:pr-5", "6": "md:pr-6", "7": "md:pr-7", "8": "md:pr-8", "9": "md:pr-9",
  "10": "md:pr-10", "11": "md:pr-11", "12": "md:pr-12", "14": "md:pr-14", "16": "md:pr-16",
  "20": "md:pr-20", "24": "md:pr-24", "28": "md:pr-28", "32": "md:pr-32", "36": "md:pr-36",
  "40": "md:pr-40", "44": "md:pr-44", "48": "md:pr-48", "52": "md:pr-52", "56": "md:pr-56",
  "60": "md:pr-60", "64": "md:pr-64", "72": "md:pr-72", "80": "md:pr-80", "96": "md:pr-96",
};

const getPaddingClass = (padding?: string, side: "left" | "right" = "left"): string => {
  const paddingMap = side === "left" ? paddingLeftMap : paddingRightMap;
  return padding ? (paddingMap[padding] || "") : "";
};

interface BulletGroup {
  title: string;
  description?: string;
  bullets?: { text: string }[];
}

function BulletGroups({ 
  groups, 
  bulletChar, 
  textFontSize,
  collapsible = true 
}: { 
  groups: BulletGroup[]; 
  bulletChar?: string;
  textFontSize: string;
  collapsible?: boolean;
}) {
  const [expandedGroups, setExpandedGroups] = useState<Record<number, boolean>>({});

  const toggleGroup = (index: number) => {
    setExpandedGroups(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  return (
    <div className="w-full space-y-4 pl-4" data-testid="list-two-column-bullet-groups">
      {groups.map((group, groupIndex) => {
        const isExpanded = expandedGroups[groupIndex] ?? false;
        const hasContent = (group.description || (group.bullets && group.bullets.length > 0));
        
        return (
          <div key={groupIndex} className="space-y-2">
            {collapsible && hasContent ? (
              <button
                onClick={() => toggleGroup(groupIndex)}
                className="lg:hidden flex items-center gap-2 w-full text-left"
                data-testid={`button-toggle-group-${groupIndex}`}
              >
                <h4 className="font-bold text-foreground uppercase tracking-wide text-sm">
                  {group.title}
                </h4>
                {renderIcon(isExpanded ? "ChevronUp" : "ChevronDown", "w-4 h-4 text-muted-foreground")}
              </button>
            ) : null}
            <h4 className={`font-bold text-foreground uppercase tracking-wide text-sm ${collapsible && hasContent ? "hidden lg:block" : ""}`}>
              {group.title}
            </h4>
            {group.description && (
              <p className={`text-muted-foreground ${textFontSize} ${collapsible ? (isExpanded ? "" : "hidden lg:block") : ""}`}>
                {group.description}
              </p>
            )}
            {group.bullets && group.bullets.length > 0 && (
              <ul className={`space-y-1 pl-1 ${collapsible ? (isExpanded ? "" : "hidden lg:block") : ""}`}>
                {group.bullets.map((bullet, bulletIndex) => (
                  <li key={bulletIndex} className="flex items-start gap-2">
                    <span className="text-foreground mt-1 flex-shrink-0">
                      {bulletChar || "•"}
                    </span>
                    <span className={`text-foreground ${textFontSize}`}>{bullet.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ColumnContent({ column, defaultBulletIcon, hideHeadingOnTablet, columnKey }: { column: TwoColumnColumn; defaultBulletIcon?: string; hideHeadingOnTablet?: boolean; columnKey?: "left" | "right" }) {
  const handleLinkClick = useInternalNav();
  const [bulletsExpanded, setBulletsExpanded] = useState(false);
  const [expandedBullets, setExpandedBullets] = useState<Record<number, boolean>>({});
  const [descExpanded, setDescExpanded] = useState(false);
  
  const toggleBullet = (index: number) => {
    setExpandedBullets(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };
  const bulletIcon = column.bullet_icon || defaultBulletIcon || "Check";
  const bulletIconColor = column.bullet_icon_color || "text-primary";
  const gapClass = getGapClass(column.gap);
  const textAlignClass = getTextAlignClass(column.text_align);
  const textFontSize = getTextFontSize(column.font_size);

  const hasTextContent = column.heading || column.sub_heading || column.description || column.html_content || column.bullets || column.bullet_groups || column.footer_description || column.button;

  return (
    <div className={`flex flex-col ${gapClass}`}>
      {hasTextContent && (
        <div className={`flex flex-col ${gapClass} w-full ${textAlignClass}`}>
          {column.heading && (
            <h2
              className="text-foreground text-[36px]"
              data-testid="text-two-column-heading"
              dangerouslySetInnerHTML={{ __html: column.heading }}
            />
          )}
          
          {column.sub_heading && (
            <p 
              className={textFontSize}
              data-testid="text-two-column-subheading"
            >
              {column.sub_heading}
            </p>
          )}
          
          {column.description && (
            <RichTextContent
              html={column.description}
              className={`${textFontSize} text-muted-foreground`}
              data-testid="text-two-column-description"
            />
          )}

          {column.description_extended && (
            <>
              {descExpanded && (
                <p
                  className={`${textFontSize} text-muted-foreground leading-relaxed`}
                  data-testid="text-two-column-description-extended"
                >
                  {column.description_extended}
                </p>
              )}
              <button
                onClick={() => setDescExpanded(!descExpanded)}
                className="text-primary hover:text-primary/80 text-sm font-medium flex items-center gap-1 self-start"
                data-testid="button-toggle-description"
              >
                {descExpanded ? (
                  <>{renderIcon("ChevronUp", "w-4 h-4")} Show less</>
                ) : (
                  <>{renderIcon("ChevronDown", "w-4 h-4")} Read more</>
                )}
              </button>
            </>
          )}

          {column.html_content && (
            <div 
              className="text-muted-foreground leading-relaxed"
              dangerouslySetInnerHTML={{ __html: column.html_content }}
              data-testid="html-two-column-content"
            />
          )}

          {column.html_content_extended && (
            <>
              {descExpanded && (
                <div
                  className="text-muted-foreground leading-relaxed"
                  dangerouslySetInnerHTML={{ __html: column.html_content_extended }}
                  data-testid="html-two-column-content-extended"
                />
              )}
              {!column.description_extended && (
                <button
                  onClick={() => setDescExpanded(!descExpanded)}
                  className="text-primary hover:text-primary/80 text-sm font-medium flex items-center gap-1 self-start"
                  data-testid="button-toggle-html-content"
                >
                  {descExpanded ? (
                    <>{renderIcon("ChevronUp", "w-4 h-4")} Show less</>
                  ) : (
                    <>{renderIcon("ChevronDown", "w-4 h-4")} Read more</>
                  )}
                </button>
              )}
            </>
          )}

          {column.description_extended_md && (
            <>
              {descExpanded && (
                <div
                  className={`prose max-w-none ${textFontSize} text-muted-foreground prose-a:text-primary prose-a:no-underline prose-a:hover:underline`}
                  data-testid="md-two-column-description-extended"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {column.description_extended_md}
                  </ReactMarkdown>
                </div>
              )}
              {!column.description_extended && !column.html_content_extended && (
                <button
                  onClick={() => setDescExpanded(!descExpanded)}
                  className="text-primary hover:text-primary/80 text-sm font-medium flex items-center gap-1 self-start"
                  data-testid="button-toggle-description-md"
                >
                  {descExpanded ? (
                    <>{renderIcon("ChevronUp", "w-4 h-4")} Show less</>
                  ) : (
                    <>{renderIcon("ChevronDown", "w-4 h-4")} Read more</>
                  )}
                </button>
              )}
            </>
          )}
          
          {column.bullets && column.bullets.length > 0 && (() => {
            const visibleCount = column.bullets_visible ?? column.bullets.length;
            const hiddenCount = column.bullets.length - visibleCount;
            const hasHiddenBullets = hiddenCount > 0;
            const isCollapsible = column.bullets_collapsible !== false;
            const hasHeadedBullets = column.bullets.some(b => b.heading);
            
            return (
              <div className="w-full pl-2">
                <ul className={`space-y-4 flex flex-col ${column.text_align === "center" ? "items-center" : column.text_align === "right" ? "items-end" : "items-start"}`} data-testid="list-two-column-bullets">
                  {column.bullets.map((bullet, index) => {
                    const isHiddenOnMobile = !bulletsExpanded && index >= visibleCount;
                    const isExpanded = expandedBullets[index] ?? false;
                    const canCollapse = isCollapsible && bullet.heading;
                    
                    return (
                      <li 
                        key={index} 
                        className={`flex items-start gap-3 w-full ${isHiddenOnMobile ? "hidden lg:flex" : ""}`}
                      >
                        <span className={`${bulletIconColor} mt-1 flex-shrink-0`}>
                          {column.bullet_char 
                            ? column.bullet_char 
                            : renderIcon(bullet.icon || bulletIcon, "w-5 h-5")
                          }
                        </span>
                        <div className="flex flex-col flex-1">
                          {bullet.heading && canCollapse ? (
                            <>
                              <button
                                onClick={() => toggleBullet(index)}
                                className="lg:hidden flex items-start justify-between w-full text-left"
                                data-testid={`button-toggle-bullet-${index}`}
                              >
                                <span className={`font-semibold text-foreground ${textFontSize}`}>{bullet.heading}</span>
                                {renderIcon(isExpanded ? "ChevronUp" : "ChevronDown", "w-4 h-4 text-muted-foreground flex-shrink-0 mt-1")}
                              </button>
                              <span className={`font-semibold text-foreground ${textFontSize} hidden lg:block`}>{bullet.heading}</span>
                              <span className={`text-foreground ${textFontSize} ${isExpanded ? "" : "hidden lg:block"}`}>{bullet.text}</span>
                            </>
                          ) : (
                            <>
                              {bullet.heading && (
                                <span className={`font-semibold text-foreground ${textFontSize}`}>{bullet.heading}</span>
                              )}
                              <span className={`text-foreground ${textFontSize}`}>{bullet.text}</span>
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {hasHiddenBullets && (
                  <button
                    onClick={() => setBulletsExpanded(!bulletsExpanded)}
                    className="lg:hidden mt-4 text-primary hover:text-primary/80 text-sm font-medium flex items-center gap-1"
                    data-testid="button-toggle-bullets"
                  >
                    {bulletsExpanded ? (
                      <>
                        {renderIcon("ChevronUp", "w-4 h-4")}
                        Show less
                      </>
                    ) : (
                      <>
                        {renderIcon("ChevronDown", "w-4 h-4")}
                        Show {hiddenCount} more
                      </>
                    )}
                  </button>
                )}
              </div>
            );
          })()}

          {column.bullet_groups && column.bullet_groups.length > 0 && (
            <BulletGroups 
              groups={column.bullet_groups} 
              bulletChar={column.bullet_char}
              textFontSize={textFontSize}
              collapsible={column.bullet_groups_collapsible !== false}
            />
          )}

          {column.footer_description && (
            <p 
              className={`${textFontSize} text-muted-foreground leading-relaxed italic`}
              data-testid="text-two-column-footer-description"
            >
              {column.footer_description}
            </p>
          )}
          
          {column.button && (
            <div className="mt-2">
              <Button
                variant={column.button.variant === "primary" ? "default" : column.button.variant}
                size="lg"
                asChild
                data-testid="button-two-column-cta"
              >
                <a href={column.button.url} onClick={handleLinkClick} className="flex items-center gap-2">
                  {column.button.icon && renderIcon(column.button.icon)}
                  {column.button.text}
                </a>
              </Button>
            </div>
          )}
        </div>
      )}
      {column.image && (() => {
        const imageId = `img-${Math.random().toString(36).substr(2, 9)}`;
        
        return (
          <div className={`flex w-full ${getResponsiveJustifyClass(column.justify)}`}>
            <style>{`
              #${imageId} {
                max-width: ${column.image_mobile_max_width || "280px"};
                max-height: ${column.image_mobile_max_height || column.image_max_height || "none"};
              }
              @media (min-width: 768px) {
                #${imageId} {
                  max-width: ${column.image_max_width || "100%"};
                  max-height: ${column.image_max_height || "none"};
                }
              }
            `}</style>
            <div id={imageId}>
              <UniversalImage
                id={column.image}
                alt={column.image_alt || "Section image"}
                className="rounded-md w-full h-auto"
                style={{
                  objectFit: (column.image_object_fit as React.CSSProperties["objectFit"]) || "cover",
                  objectPosition: column.image_object_position || "center center",
                }}
                fieldContext={columnKey ? { fieldPath: `${columnKey}.image` } : undefined}
                data-testid="img-two-column"
              />
            </div>
          </div>
        );
      })()}
      <ColumnVideo
        video={column.video}
        videoRatio={column.video_ratio}
        videoPreviewImage={column.video_preview_image}
        videoWidth={column.video_width}
        justify={column.justify}
      />
    </div>
  );
}

function BenefitCardsVariant({ data }: TwoColumnProps) {
  const handleLinkClick = useInternalNav();
  const backgroundClass = data.background || "bg-muted/30";
  const stackedHeader = data.stacked_header === true;
  
  return (
    <section 
      className={backgroundClass}
      data-testid="section-two-column-benefit-cards"
    >
      <div className="max-w-6xl mx-auto px-4">
        {/* Stacked header: Title and subtitle above both columns */}
        {stackedHeader && (data.title || data.subtitle) && (
          <div className="mb-8">
            {data.title && (
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4" data-testid="text-benefit-cards-title">
                {data.title}
              </h2>
            )}
            {data.subtitle && (
              <p className="text-muted-foreground" data-testid="text-benefit-cards-subtitle">
                {data.subtitle}
              </p>
            )}
          </div>
        )}
        
        <div className={`grid grid-cols-1 md:grid-cols-2 gap-12 ${stackedHeader ? 'items-center' : ''}`}>
          {/* Left Column: Title + Subtitle (if not stacked) + Benefit Cards + CTA */}
          <div className="flex flex-col">
            {!stackedHeader && data.title && (
              <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4" data-testid="text-benefit-cards-title">
                {data.title}
              </h2>
            )}
            {!stackedHeader && data.subtitle && (
              <p className="text-muted-foreground mb-8" data-testid="text-benefit-cards-subtitle">
                {data.subtitle}
              </p>
            )}
            
            {data.benefit_items && data.benefit_items.length > 0 && (
              <div className="flex flex-col gap-6 mb-8">
                {data.benefit_items.map((item, index) => {
                  const IconComponent = item.icon ? getIcon(`Icon${item.icon}`) : null;
                  return (
                    <div 
                      key={index}
                      className="flex items-start gap-4 p-4 bg-card rounded-lg shadow-sm"
                      data-testid={`benefit-card-${index}`}
                    >
                      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                        {IconComponent && <IconComponent className="text-primary" size={24} />}
                      </div>
                      <div className="flex flex-col">
                        <h3 className="font-semibold text-foreground mb-1">{item.title}</h3>
                        <p className="text-sm text-muted-foreground">{item.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            
            {data.cta_button && (
              <div className="mt-auto">
                <a href={data.cta_button.url || "#"} onClick={handleLinkClick}>
                  <Button 
                    variant={
                      data.cta_button.variant === "outline"
                        ? "outline"
                        : data.cta_button.variant === "accent"
                          ? "accent"
                          : "default"
                    }
                    size="lg"
                    data-testid="button-benefit-cards-cta"
                  >
                    {data.cta_button.text}
                  </Button>
                </a>
              </div>
            )}
          </div>
          
          {/* Right Column: Video or Image (centered vertically when stacked) */}
          {(data.right?.video || data.right?.image) && (
            <div className="flex items-center justify-center">
              {data.right?.video ? (
                <ColumnVideo
                  video={data.right.video}
                  videoRatio={data.right.video_ratio}
                  videoPreviewImage={data.right.video_preview_image}
                  videoWidth={data.right.video_width}
                  wrapperClassName="w-full max-w-md"
                />
              ) : data.right?.image ? (
                <UniversalImage
                  id={data.right.image}
                  alt={data.right.image_alt || "Section image"}
                  className="rounded-md w-full h-auto max-w-md"
                  fieldContext={{ fieldPath: "right.image" }}
                  data-testid="img-benefit-cards"
                />
              ) : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export function TwoColumn({ data }: TwoColumnProps) {
  // Route to benefitCards variant if specified
  if (data.variant === "benefitCards") {
    return <BenefitCardsVariant data={data} />;
  }
  
  const [leftProportion, rightProportion] = data.proportions || [6, 6];
  const alignmentClass = getAlignmentClass(data.alignment);
  const leftColClass = getGridColClass(leftProportion);
  const rightColClass = getGridColClass(rightProportion);
  const columnGapClass = getGapClass(data.gap || "8");
  const paddingLeftClass = getPaddingClass(data.padding_left, "left");
  const paddingRightClass = getPaddingClass(data.padding_right, "right");
  
  const containerStyle: CSSProperties = data.container_style 
    ? (data.container_style as unknown as CSSProperties)
    : {};

  const backgroundClass = data.background || "bg-background";
  
  const headingAboveOnMd = data.heading_above_on_md !== false;
  const tabletHeading = data.left?.heading || data.right?.heading;
  const leftHasHeading = !!data.left?.heading;
  const rightHasHeading = !!data.right?.heading;

  return (
    <section 
      className={`${backgroundClass}`}
      data-testid="section-two-column"
      style={containerStyle}
    >
      <div className={`max-w-6xl mx-auto px-4 ${paddingLeftClass} ${paddingRightClass}`}>
        {headingAboveOnMd && tabletHeading && (
          <h2 
            className="hidden md:block lg:hidden text-h2 text-foreground text-center mb-8"
            data-testid="text-two-column-heading-tablet"
          >
            {tabletHeading}
          </h2>
        )}
        <div className={`grid grid-cols-1 md:grid-cols-12 ${columnGapClass} ${alignmentClass}`}>
          {data.left && (
            <div className={`col-span-1 ${leftColClass} ${data.reverse_on_mobile ? "order-2 md:order-1" : ""}`}>
              <ColumnContent column={data.left} hideHeadingOnTablet={headingAboveOnMd && leftHasHeading} columnKey="left" />
            </div>
          )}
          
          {data.right && (
            <div className={`col-span-1 ${rightColClass} ${data.reverse_on_mobile ? "order-1 md:order-2" : ""}`}>
              <ColumnContent column={data.right} hideHeadingOnTablet={headingAboveOnMd && rightHasHeading} columnKey="right" />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default TwoColumn;
