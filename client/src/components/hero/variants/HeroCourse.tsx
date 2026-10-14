
import type { HeroCourse as HeroCourseType } from "@shared/schema";
import { Book, Check, Star } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UniversalVideo } from "@/components/UniversalVideo";
import { UniversalImage } from "@/components/UniversalImage";
import { getIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";
import { useInternalNav } from "@/hooks/useInternalNav";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { resolveTemplateFallback } from "@/lib/variable-manager";
import { lazy, Suspense, useEffect, useRef } from "react";
import { trackEcommerce } from "@/lib/tracking";
import { ensureEcommerceProductLookup } from "@/lib/ecommerceProductMap";
import { resolveProgramIdForPage, programIdFromCtaUrl } from "@/lib/ecommerceProgramId";
import { usePageFunnel } from "@/contexts/PageFunnelContext";
import { resolveProductScope } from "@shared/resolveProductScope";
import type { FunnelBlock } from "@shared/funnel";
import { useSectionContext } from "@/contexts/SectionContext";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { isCtaTrackingValue } from "@shared/component-behaviors";

function programIdFromHeroData(
  data: HeroCourseType,
  ctaUrl?: unknown,
  ctx?: { contentType?: string; contentSlug?: string; funnel?: FunnelBlock | null },
): string | undefined {
  const fromPath =
    typeof window !== "undefined" ? resolveProgramIdForPage(ctaUrl) : programIdFromCtaUrl(ctaUrl);
  const { scope } = resolveProductScope(data as unknown as Record<string, unknown>, {
    contentType: ctx?.contentType ?? (fromPath ? "program" : undefined),
    contentSlug: ctx?.contentSlug ?? fromPath,
    funnel: ctx?.funnel,
  });
  if (scope === "all") {
    return programIdFromCtaUrl(ctaUrl) || fromPath;
  }
  if (Array.isArray(scope) && scope.length === 1) return scope[0];
  if (Array.isArray(scope) && scope.length > 1) {
    const fromCta = programIdFromCtaUrl(ctaUrl);
    if (fromCta && scope.includes(fromCta)) return fromCta;
    return scope[0];
  }
  return programIdFromCtaUrl(ctaUrl) || fromPath;
}

const LeadForm = lazy(() => import("@/components/lead_form/variants/LeadFormDefault"));

interface HeroCourseProps {
  data: HeroCourseType;
}

const BADGE_COLOR_CLASSES: Record<string, string> = {
  primary: "bg-primary/10 text-primary",
  secondary: "bg-secondary text-secondary-foreground",
  accent: "bg-accent text-accent-foreground",
  muted: "bg-muted text-muted-foreground",
  destructive: "bg-destructive/10 text-destructive",
};

export default function HeroCourse({ data }: HeroCourseProps) {
  const handleLinkClick = useInternalNav();
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;
  const viewedRef = useRef(false);
  const { contentType, slug } = useSectionContext();
  const funnel = usePageFunnel();
  const scopeCtx = { contentType, contentSlug: slug, funnel };

  useEffect(() => {
    if (isEditMode || viewedRef.current) return;
    let cancelled = false;
    (async () => {
      await ensureEcommerceProductLookup();
      if (cancelled || viewedRef.current) return;
      const programId = programIdFromHeroData(data, data.signup_card?.cta_button?.url, scopeCtx);
      if (!programId) return;
      viewedRef.current = true;
      trackEcommerce("view_item", {
        program_id: programId,
        component_type: "hero",
        component_variant: "course",
        path: typeof window !== "undefined" ? window.location.pathname : undefined,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [isEditMode, data, contentType, slug, funnel]);

  const handleCtaClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const cta = data.signup_card?.cta_button as
      | { url?: string; tracking?: string }
      | undefined;
    const tracking = cta?.tracking;
    if (isCtaTrackingValue(tracking) && tracking !== "none") {
      const programId = programIdFromHeroData(data, cta?.url, scopeCtx);
      void ensureEcommerceProductLookup().then(() => {
        trackEcommerce(tracking, {
          program_id: programId,
          component_type: "hero",
          component_variant: "course",
          path: typeof window !== "undefined" ? window.location.pathname : undefined,
        });
      });
    }
    handleLinkClick(e);
  };

  return (
    <section className="bg-background" data-testid="section-hero">
      <div className="max-w-6xl mx-auto px-4">
        <div
          className={cn(
            "grid gap-8 lg:gap-12",
            data.layout_reversed
              ? "lg:grid-cols-[2fr_3fr]"
              : "lg:grid-cols-[3fr_2fr]",
          )}
        >
          {/* Content column (left by default, right when reversed) */}
          <div
            className={cn("relative", data.layout_reversed && "lg:order-2")}
          >
            {data.badge?.text && (
              <span
                className={cn(
                  "absolute -top-8 left-0 z-10 inline-block px-3 py-1 rounded-full text-xs font-medium",
                  !data.badge.background &&
                    (BADGE_COLOR_CLASSES[data.badge.color || "primary"] ||
                      BADGE_COLOR_CLASSES.primary),
                )}
                style={{
                  ...(data.badge.background
                    ? { background: data.badge.background }
                    : {}),
                  ...(data.badge.text_color
                    ? { color: data.badge.text_color }
                    : {}),
                }}
                data-testid="text-hero-badge"
              >
                {data.badge.text}
              </span>
            )}

            <div className="space-y-6">
            <h1
              className="text-h1 text-foreground"
              data-testid="text-hero-title"
            >
              {data.title_highlight &&
              data.title.includes(data.title_highlight) ? (
                <>
                  {data.title.split(data.title_highlight)[0]}
                  <span className="text-primary">{data.title_highlight}</span>
                  {data.title.split(data.title_highlight)[1]}
                </>
              ) : (
                data.title
              )}
            </h1>

            {data.subtitle && (
              <p
                className="text-body text-muted-foreground"
                data-testid="text-hero-subtitle"
              >
                {data.subtitle}
              </p>
            )}

            {data.students_enrolled && (
              <div className="flex items-center gap-3">
                {data.students_enrolled.avatars &&
                  data.students_enrolled.avatars.length > 0 && (
                    <div className="flex -space-x-2">
                      {data.students_enrolled.avatars
                        .slice(0, 4)
                        .map((avatar, index) => (
                          <div
                            key={index}
                            className="w-8 h-8 rounded-full overflow-hidden border-2 border-background shrink-0"
                          >
                            <UniversalImage
                              id={avatar}
                              alt={`Student ${index + 1}`}
                              className="w-full h-full"
                              fieldContext={{ arrayPath: "students_enrolled.avatars", index, srcField: "src" }}
                            />
                          </div>
                        ))}
                    </div>
                  )}
                <span className="text-sm text-muted-foreground">
                  {data.students_enrolled.count}
                </span>
              </div>
            )}

            {data.bullet_points && data.bullet_points.length > 0 && (
              <ul className="space-y-3">
                {data.bullet_points.map((point, index) => (
                  <li key={index} className="flex items-start gap-3">
                    <Check className="w-5 h-5 text-primary mt-0.5 flex-shrink-0" />
                    <span className="text-foreground">{point}</span>
                  </li>
                ))}
              </ul>
            )}

            {data.rating && (
              <div
                className="flex items-center gap-2"
                data-testid="hero-rating"
              >
                <span className="text-foreground font-medium">
                  {String(data.rating.value)}
                </span>
                <div className="flex">
                  {[1, 2, 3, 4, 5].map((star) => {
                    const ratingNum =
                      parseFloat(
                        resolveTemplateFallback(String(data.rating!.value)),
                      ) || 0;
                    const fullStars = Math.floor(ratingNum);
                    const hasHalf = ratingNum % 1 >= 0.5;
                    const isHalfStar = hasHalf && star === fullStars + 1;

                    if (star <= fullStars) {
                      return (
                        <Star
                          key={star}
                          className="fill-current h-5 w-5 text-yellow-500"
                        />
                      );
                    } else if (isHalfStar) {
                      return (
                        <div key={star} className="relative h-5 w-5">
                          <Star className="fill-current h-5 w-5 text-muted" />
                          <div
                            className="absolute inset-0 overflow-hidden"
                            style={{ width: "50%" }}
                          >
                            <Star className="fill-current h-5 w-5 text-yellow-500" />
                          </div>
                        </div>
                      );
                    } else {
                      return (
                        <Star
                          key={star}
                          className="fill-current h-5 w-5 text-muted"
                        />
                      );
                    }
                  })}
                </div>
                {data.rating.reviews_anchor ? (
                  <a
                    href={data.rating.reviews_anchor}
                    onClick={handleLinkClick}
                    className="text-primary hover:underline text-sm"
                    data-testid="link-hero-rating"
                  >
                    {String(data.rating.count)}
                  </a>
                ) : (
                  <span className="text-muted-foreground text-sm">
                    {String(data.rating.count)}
                  </span>
                )}
              </div>
            )}

            {data.tutors && data.tutors.length > 0 && (
              <div className="pt-4">
                <p className="text-sm font-medium text-muted-foreground mb-3">
                  {data.tutors_label || "Your tutors:"}
                </p>
                <div className="flex flex-wrap gap-4">
                  {data.tutors.map((tutor, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-3 bg-muted rounded-lg px-3 py-2"
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden shrink-0">
                        <UniversalImage
                          id={tutor.image}
                          alt={tutor.name}
                          className="w-full h-full"
                          fieldContext={{ arrayPath: "tutors", index, srcField: "image" }}
                        />
                      </div>
                      <div>
                        <p className="font-medium text-sm text-primary">
                          {tutor.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {tutor.role}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {data.description && (
              <RichTextContent
                html={data.description}
                className="text-foreground leading-relaxed pt-4"
              />
            )}
            </div>
          </div>

          {/* Media + signup column (right by default, left when reversed) */}
          <div
            className={cn("space-y-4", data.layout_reversed && "lg:order-1")}
          >
            {(data.video?.url?.trim() || data.media) && (
              <div className="relative rounded-lg overflow-hidden aspect-video">
                {data.video?.url?.trim() ? (
                  <UniversalVideo
                    url={data.video.url}
                    ratio={data.video.ratio || "16:9"}
                    autoplay={data.video.autoplay === true}
                    muted={data.video.muted !== false}
                    loop={data.video.loop !== false}
                    preview_image_url={data.video.preview_image_url}
                    open_modal_on_click={data.video.open_modal_on_click}
                    overlay_on_muted={data.video.overlay_on_muted}
                  />
                ) : data.media?.type === "video" ? (
                  <UniversalVideo
                    url={data.media.src}
                    ratio="16:9"
                    autoplay={true}
                    muted={true}
                    loop={true}
                  />
                ) : data.media ? (
                  <img
                    src={data.media.src}
                    alt={data.media.alt || "Hero image"}
                    className="w-full h-full object-cover"
                  />
                ) : null}
              </div>
            )}

            {/* Signup Card */}
            {data.signup_card && 
            <Card className="p-6">
              <h3 className="text-xl font-semibold mb-2">
                {data.signup_card?.title}
              </h3>
              {data.signup_card?.description && (
                <p className="text-sm text-muted-foreground mb-4">
                  {data.signup_card?.description}
                </p>
              )}

              {data.signup_card?.form && (
                <div data-hero-inline-form className="mb-2">
                  <Suspense
                    fallback={
                      <div className="h-24 flex items-center justify-center text-muted-foreground text-sm">
                        Loading...
                      </div>
                    }
                  >
                    <LeadForm data={data.signup_card?.form} />
                  </Suspense>
                </div>
              )}
              {data.signup_card?.cta_button && (
                <>
                  <Button
                    className="w-full mb-3"
                    size="lg"
                    variant={
                      data.signup_card?.cta_button.variant === "outline"
                        ? "outline"
                        : data.signup_card?.cta_button.variant === "secondary"
                          ? "secondary"
                          : "default"
                    }
                    data-testid="button-hero-cta"
                    asChild
                  >
                    <a
                      href={data.signup_card?.cta_button.url}
                      onClick={handleCtaClick}
                      data-testid="button-hero-cta"
                    >
                      {data.signup_card?.cta_button.text}
                    </a>
                  </Button>
                </>
              )}
              {data.signup_card?.login_link?.text &&
                (data.signup_card?.login_link.url ? (
                  <a
                    href={data.signup_card?.login_link.url}
                    onClick={handleLinkClick}
                    data-testid="link-hero-login"
                  >
                    <RichTextContent
                      html={data.signup_card?.login_link.text}
                      className="text-sm text-center text-muted-foreground mb-6 text-primary text-primary hover:underline"
                      data-testid="text-hero-login-link"
                    />
                  </a>
                ) : (
                  <RichTextContent
                    html={data.signup_card?.login_link.text}
                    className="text-sm text-center text-muted-foreground mb-6"
                    data-testid="text-hero-login-link"
                  />
                ))}
              {data.signup_card?.features &&
                data.signup_card?.features.length > 0 && (
                  <div className="border-t pt-4 space-y-3">
                    {data.signup_card?.features.map((feature, index) => {
                      const IconComponent = getIcon(feature.icon) || Book;
                      return (
                        <div
                          key={index}
                          className="flex items-center justify-between text-sm"
                        >
                          <div className="flex items-center gap-3">
                            <IconComponent className="w-4 h-4 text-muted-foreground" />
                            <span>{feature.text}</span>
                          </div>
                          {feature.count !== undefined && (
                            <span className="font-medium">{feature.count}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
            </Card>
            }
          </div>
        </div>
      </div>
    </section>
  );
}
