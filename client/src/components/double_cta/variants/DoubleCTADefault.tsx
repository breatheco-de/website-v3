
import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UniversalImage } from "@/components/UniversalImage";
import type { DoubleCTASection, DoubleCTABox } from "@shared/schema";
import { CircleCheck } from "lucide-react";
import { getIcon } from "@/lib/icons";

function getTablerIcon(name: string) {
  return getIcon(name) || CircleCheck;
}

type ActiveSide = "left" | "right";

interface DoubleCTAExpandableProps {
  data: DoubleCTASection;
}

function CTABox({
  box,
  isActive,
  isContentExpanded,
  onHover,
  onClick,
  side,
  imageFieldPath,
  "data-testid": testId,
}: {
  box: DoubleCTABox;
  isActive: boolean;
  isContentExpanded: boolean;
  onHover: () => void;
  onClick: () => void;
  side: ActiveSide;
  imageFieldPath?: string;
  "data-testid"?: string;
}) {
  const hasBullets = box.bullets && box.bullets.length > 0;
  const hasImage = !!box.image_id;

  const renderBullets = (testIdPrefix: string) => {
    if (!hasBullets) return null;
    return (
      <div
        className="flex flex-col gap-3 flex-1"
        data-testid={`${testIdPrefix}-bullets`}
      >
        {box.bullets!.map((bullet, i) => {
          const IconComp = bullet.icon
            ? getTablerIcon(bullet.icon)
            : CircleCheck;
          return (
            <div
              key={i}
              className="flex items-start gap-2.5"
              data-testid={`${testIdPrefix}-bullet-${i}`}
            >
              <Card className="flex-shrink-0 p-1 !rounded-lg">
                <IconComp className="w-4 h-4 text-primary" />
              </Card>
              {bullet.text && (
                <span className={cn("text-sm text-muted-foreground leading-snug", isContentExpanded ? "" : "line-clamp-1")}>
                  {bullet.text}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Card
      className={cn(
        "relative flex flex-col overflow-hidden p-6 lg:p-8 transition-all duration-500 ease-in-out lg:h-full",
        side == "right" ? "bg-primary/5" : "",
        isActive ? "border-primary md:border-card border-2 lg:border lg:border-border" : "",
      )}
      onMouseEnter={onHover}
      onClick={onClick}
      data-testid={testId}
    >
      {box.heading && (
        <h3
          className={cn(
            "font-bold text-foreground transition-all duration-500 ease-in-out",
            "text-lg lg:text-3xl",
            isContentExpanded
              ? "lg:text-3xl"
              : "lg:text-3xl lg:line-clamp-1",
            side == "right" ? "text-primary" : "",
            isActive ? "" : "lg:opacity-50"
          )}
          data-testid={`${testId}-heading`}
        >
          {box.heading}
        </h3>
      )}

      <div
        className={cn(
          "flex flex-col flex-1 transition-all duration-500 ease-in-out mt-3",
          isActive
            ? "opacity-100 max-h-[1000px]"
            : "lg:opacity-50 max-h-[1000px]",
        )}
      >
        {box.image_beside_bullets ? (
          <>
            {box.description && (
              <p
                className={cn(
                  "text-sm md:text-base text-muted-foreground leading-relaxed mb-4",
                  isContentExpanded ? "" : "line-clamp-3",
                )}
                data-testid={`${testId}-description`}
              >
                {box.description}
              </p>
            )}

            <div className="flex gap-4 mb-4 flex-1">
              {renderBullets(testId || "")}

              {hasImage && (
                <div
                  className={cn(
                    "relative rounded-lg flex-shrink-0 transition-all duration-100 ease-in-out hidden lg:block",
                    isActive
                      ? "w-[120px] md:w-[160px] lg:w-[40%] opacity-100"
                      : "w-0 opacity-0",
                  )}
                  data-testid={`${testId}-image`}
                >
                  <UniversalImage
                    id={box.image_id!}
                    className="w-full h-full rounded-lg"
                    style={{
                      objectFit:
                        (box.image_object_fit as React.CSSProperties["objectFit"]) ||
                        "cover",
                      objectPosition: box.image_object_position || "center",
                    }}
                    fieldContext={imageFieldPath ? { fieldPath: imageFieldPath } : undefined}
                  />
                </div>
              )}
            </div>

            {hasImage && isActive && (
              <div className="lg:hidden mb-4">
                <div className="relative rounded-lg w-full h-[160px]">
                  <UniversalImage
                    id={box.image_id!}
                    className="w-full h-full rounded-lg"
                    style={{
                      objectFit:
                        (box.image_object_fit as React.CSSProperties["objectFit"]) ||
                        "cover",
                      objectPosition: box.image_object_position || "center",
                    }}
                    fieldContext={imageFieldPath ? { fieldPath: imageFieldPath } : undefined}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex gap-4 mb-5 flex-1">
              <div className="flex flex-col flex-1 gap-4">
                {box.description && (
                  <p
                    className={cn(
                      "text-sm md:text-base text-muted-foreground leading-relaxed",
                      isContentExpanded ? "" : "line-clamp-3",
                    )}
                    data-testid={`${testId}-description`}
                  >
                    {box.description}
                  </p>
                )}
                {renderBullets(testId || "")}
              </div>

              {hasImage && (
                <div
                  className={cn(
                    "relative rounded-lg flex-shrink-0 transition-all duration-100 ease-in-out hidden lg:block",
                    isActive
                      ? "w-[120px] md:w-[160px] lg:w-[40%] opacity-100"
                      : "w-0 opacity-0",
                  )}
                  data-testid={`${testId}-image`}
                >
                  <UniversalImage
                    id={box.image_id!}
                    className="w-full h-full rounded-lg"
                    style={{
                      objectFit:
                        (box.image_object_fit as React.CSSProperties["objectFit"]) ||
                        "cover",
                      objectPosition: box.image_object_position || "center",
                    }}
                    fieldContext={imageFieldPath ? { fieldPath: imageFieldPath } : undefined}
                  />
                </div>
              )}
            </div>

            {hasImage && isActive && (
              <div className="lg:hidden mb-4">
                <div className="relative rounded-lg w-full h-[160px]">
                  <UniversalImage
                    id={box.image_id!}
                    className="w-full h-full rounded-lg"
                    style={{
                      objectFit:
                        (box.image_object_fit as React.CSSProperties["objectFit"]) ||
                        "cover",
                      objectPosition: box.image_object_position || "center",
                    }}
                    fieldContext={imageFieldPath ? { fieldPath: imageFieldPath } : undefined}
                  />
                </div>
              </div>
            )}
          </>
        )}

        {box.cta_text && box.cta_url && (
        <div className="mt-auto">
          <a href={box.cta_url} data-testid={`${testId}-cta-link`}>
            <Button
              className="w-full"
              variant={
                box.cta_variant === "secondary"
                  ? "secondary"
                  : box.cta_variant === "outline"
                    ? "outline"
                    : box.cta_variant === "accent"
                      ? "accent"
                      : "default"
              }
              data-testid={`${testId}-cta`}
            >
              {box.cta_text}
            </Button>
          </a>
          {box.sub_text && (
            <p
              className="text-xs text-muted-foreground text-center mt-2"
              data-testid={`${testId}-subtext`}
            >
              {box.sub_text}
            </p>
          )}
        </div>
        )}
      </div>
    </Card>
  );
}

export default function DoubleCTAExpandable({ data }: DoubleCTAExpandableProps) {
  const { title, subtitle, left, right } = data;
  const [activeSide, setActiveSide] = useState<ActiveSide | null>(null);
  const [contentExpandedSide, setContentExpandedSide] = useState<ActiveSide | null>(null);
  const [hasAnimated, setHasAnimated] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeSideRef = useRef<ActiveSide | null>(null);

  const switchToSide = (side: ActiveSide) => {
    if (side === activeSideRef.current) return;
    activeSideRef.current = side;
    setActiveSide(side);
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    setContentExpandedSide(null);
    contentTimerRef.current = setTimeout(() => {
      setContentExpandedSide(side);
    }, 350);
  };

  useEffect(() => {
    return () => {
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (hasAnimated) return;
    const el = sectionRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setTimeout(() => {
            switchToSide("left");
            setHasAnimated(true);
          }, 600);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [hasAnimated, switchToSide]);

  const handleHoverLeft = () => {
    if (activeSide !== "left") {
      switchToSide("left");
    }
  };

  const handleHoverRight = () => {
    if (activeSide !== "right") {
      switchToSide("right");
    }
  };

  const isEqual = activeSide === null;

  const [isTablet, setIsTablet] = useState(false);

  useEffect(() => {
    const checkTablet = () => {
      const w = window.innerWidth;
      setIsTablet(w >= 768 && w < 1024);
    };
    checkTablet();
    window.addEventListener("resize", checkTablet);
    return () => window.removeEventListener("resize", checkTablet);
  }, []);

  return (
    <section
      ref={sectionRef}
      className="w-full max-w-7xl mx-auto px-4 md:px-6 lg:px-8"
      data-testid="section-double-cta"
    >
      {(title || subtitle) && (
        <div
          className="text-center mb-8 md:mb-12"
          data-testid="double-cta-header"
        >
          {title && (
            <h2
              className="text-2xl md:text-3xl lg:text-4xl font-bold text-foreground"
              data-testid="text-double-cta-title"
            >
              {title}
            </h2>
          )}
          {subtitle && (
            <p
              className="text-base md:text-lg text-muted-foreground mt-3 max-w-2xl mx-auto"
              data-testid="text-double-cta-subtitle"
            >
              {subtitle}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4 lg:h-[420px]">
        {left && (
          <div
            className={cn(
              "transition-all duration-500 ease-in-out",
              "lg:min-w-0",
              isTablet ? "w-full" : "",
              isEqual
                ? "lg:flex-1"
                : activeSide === "left"
                  ? "lg:flex-[2]"
                  : "lg:flex-[0.8]",
            )}
            data-testid="double-cta-left-wrapper"
          >
            <CTABox
              box={left}
              isActive={isTablet ? true : (isEqual || activeSide === "left")}
              isContentExpanded={isTablet ? true : (isEqual || contentExpandedSide === "left")}
              onHover={isTablet ? () => {} : handleHoverLeft}
              onClick={isTablet ? () => {} : handleHoverLeft}
              side="left"
              imageFieldPath="left.image_id"
              data-testid="card-double-cta-left"
            />
          </div>
        )}

        {right && (
          <div
            className={cn(
              "transition-all duration-100 ease-in-out",
              "lg:min-w-0",
              isTablet ? "w-full" : "",
              isEqual
                ? "lg:flex-1"
                : activeSide === "right"
                  ? "lg:flex-[2]"
                  : "lg:flex-[0.8]",
            )}
            data-testid="double-cta-right-wrapper"
          >
            <CTABox
              box={right}
              isActive={isTablet ? true : (isEqual || activeSide === "right")}
              isContentExpanded={isTablet ? true : (isEqual || contentExpandedSide === "right")}
              onHover={isTablet ? () => {} : handleHoverRight}
              onClick={isTablet ? () => {} : handleHoverRight}
              side="right"
              imageFieldPath="right.image_id"
              data-testid="card-double-cta-right"
            />
          </div>
        )}
      </div>
    </section>
  );
}
