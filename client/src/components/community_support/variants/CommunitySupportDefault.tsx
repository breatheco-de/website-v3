import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { getIcon as resolveIcon } from "@/lib/icons";
import { UniversalImage } from "@/components/UniversalImage";

interface BulletItem {
  text: string;
  icon?: string;
}

interface CommunityGroup {
  title: string;
  description?: string;
  image?: string;
  icon?: string;
  badge?: string;
  accent_color?: string;
  bullets?: BulletItem[];
  button?: {
    text: string;
    url: string;
    variant?: "primary" | "secondary" | "outline" | "accent";
  };
}

interface CommunitySupportData {
  type: "community_support";
  version?: string;
  eyebrow?: string;
  heading: string;
  description: string;
  bullet_groups: CommunityGroup[];
  footer_description?: string;
  image?: string;
  image_alt?: string;
  background?: string;
}

interface CommunitySupportProps {
  data: CommunitySupportData;
}

const renderIcon = (iconName: string, className?: string, size?: number, color?: string) => {
  const IconComponent =
    resolveIcon(iconName) ??
    resolveIcon(iconName.startsWith("Icon") ? iconName : `Icon${iconName}`);
  if (!IconComponent) return null;
  const sizeStr = size ? `${size}px` : "20px";
  return (
    <IconComponent
      className={className}
      size={size || 20}
      color={color}
      width={sizeStr}
      height={sizeStr}
    />
  );
};

export function CommunitySupport({ data }: CommunitySupportProps) {
  const backgroundClass = data.background || "bg-background";
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const eyebrow = data.eyebrow ?? "Our Community";

  return (
    <section 
      className={backgroundClass}
      data-testid="section-community-support"
    >
      <div className="max-w-6xl mx-auto px-4">
        {/* Header with image on right of title/description */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-8 items-center mb-8">
          <div className="col-span-1 md:col-span-12 text-center md:text-start order-2 md:order-1">
            {eyebrow ? (
              <span
                className="text-xs font-semibold uppercase tracking-widest text-primary mb-3 block"
                data-testid="text-community-eyebrow"
              >
                {eyebrow}
              </span>
            ) : null}
            <h2 
              className="text-3xl md:text-4xl font-bold text-foreground mb-4"
              data-testid="text-community-heading"
            >
              {data.heading}
            </h2>
            <p 
              className="text-lg text-muted-foreground leading-relaxed"
              data-testid="text-community-description"
            >
              {data.description}
            </p>
          </div>
        </div>

        {/* Community groups displayed side by side with accent bars */}
        <div className="space-y-10">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8" data-testid="list-community-groups">
            {data.bullet_groups.map((group, groupIndex) => {
              const isDescExpanded = expandedGroups[`desc-${groupIndex}`] ?? false;
              const rawColor = group.accent_color || "primary";
              const isHex = rawColor.startsWith("#");
              const accentColor = isHex ? rawColor : `hsl(var(--${rawColor}))`;
              return (
                <div 
                  key={groupIndex} 
                  className="flex gap-4"
                >
                  <div 
                    className="w-1 rounded-full flex-shrink-0"
                    style={{ backgroundColor: accentColor }}
                  />
                  <div className="space-y-3 flex-1">
                    <div className="flex items-center gap-3">
                      {group.icon ? (
                        <span className="flex-shrink-0" style={{ color: accentColor }}>
                          {renderIcon(group.icon, "", 32, accentColor)}
                        </span>
                      ) : group.image ? (
                        <div className="flex-shrink-0 w-10 h-10 rounded-full overflow-hidden">
                          <UniversalImage
                            id={group.image}
                            alt="Group icon"
                            className="w-full h-full object-cover"
                            fieldContext={{ arrayPath: "bullet_groups", index: groupIndex, srcField: "image" }}
                          />
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-foreground uppercase tracking-wide text-sm">
                          {group.title}
                        </h4>
                        {group.badge && (
                          <span 
                            className="text-xs font-medium px-2 py-0.5 rounded-full text-white"
                            style={{ backgroundColor: accentColor }}
                          >
                            {group.badge}
                          </span>
                        )}
                      </div>
                    </div>
                    {group.description && (
                      <>
                        {/* Mobile: Collapsible description */}
                        <div className="md:hidden">
                          <button
                            onClick={() => setExpandedGroups(prev => ({ ...prev, [`desc-${groupIndex}`]: !prev[`desc-${groupIndex}`] }))}
                            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
                            data-testid={`button-toggle-description-${groupIndex}`}
                          >
                            <span className="flex-shrink-0">
                              {renderIcon(isDescExpanded ? "ChevronUp" : "ChevronDown", "", 16)}
                            </span>
                            <span className="text-sm">{isDescExpanded ? "Hide details" : "Show details"}</span>
                          </button>
                          {isDescExpanded && (
                            <p className="text-muted-foreground text-base leading-relaxed mt-2">
                              {group.description}
                            </p>
                          )}
                        </div>
                        {/* Tablet/Desktop: Static description */}
                        <p className="hidden md:block text-muted-foreground text-base leading-relaxed">
                          {group.description}
                        </p>
                      </>
                    )}
                    {group.bullets && group.bullets.length > 0 && (
                      <ul className="space-y-2 mt-2">
                        {group.bullets.map((bullet, bulletIndex) => (
                          <li key={bulletIndex} className="flex items-start gap-3">
                            {bullet.icon ? (
                              <span className="text-primary mt-0.5 flex-shrink-0">
                                {renderIcon(bullet.icon)}
                              </span>
                            ) : (
                              <span className="text-foreground mt-1 flex-shrink-0">•</span>
                            )}
                            <span className="text-foreground text-base">{bullet.text}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {group.button && (
                      <div className="mt-4">
                        <a 
                          href={group.button.url}
                          className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
                          data-testid={`link-community-group-${groupIndex}`}
                        >
                          {group.button.text}
                          {renderIcon("ArrowRight", "", 16)}
                        </a>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {data.footer_description && (
          <p 
            className="text-base text-muted-foreground leading-relaxed italic mt-6 text-center"
            data-testid="text-community-footer"
          >
            {data.footer_description}
          </p>
        )}
      </div>
    </section>
  );
}

export type { CommunitySupportData };

export default CommunitySupport;
