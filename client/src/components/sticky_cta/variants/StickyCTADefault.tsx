// section-spacing: overlay
import { useState, useEffect, lazy, Suspense } from "react";
import { ChevronDown, ChevronRight, ChevronUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import RigobotPeek from "@/components/custom-icons/RigobotPeek";
import { rigobotVisibilityClass, type StickyShowRigobot } from "@/components/sticky_cta/rigobotVisibility";
import { useHiddenAtPageTop } from "@/components/sticky_cta/useHiddenAtPageTop";
import { cn } from "@/lib/utils";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import type { LeadFormData } from "@shared/schema";
import { useLocation } from "wouter";

const LeadForm = lazy(() => import("@/components/lead_form/variants/LeadFormDefault"));

const INLINE_FORM_SELECTOR = "[data-hero-inline-form]";

function isElementInViewport(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.bottom > 0 && rect.top < window.innerHeight;
}

function useInlineFormVisible() {
  const [pathname] = useLocation();
  const initialEl = typeof document !== "undefined" ? document.querySelector(INLINE_FORM_SELECTOR) : null;
  const [isFormVisible, setIsFormVisible] = useState(() => initialEl ? isElementInViewport(initialEl) : false);
  const [enableTransition, setEnableTransition] = useState(false);

  useEffect(() => {
    let intersectionObserver: IntersectionObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let firstFired = false;
    let currentEl: Element | null = null;

    setEnableTransition(false);
    setIsFormVisible(false);

    function observeElement(el: Element) {
      if (intersectionObserver) intersectionObserver.disconnect();
      firstFired = false;
      setEnableTransition(false);
      setIsFormVisible(isElementInViewport(el));
      currentEl = el;
      intersectionObserver = new IntersectionObserver(
        ([entry]) => {
          setIsFormVisible(entry.isIntersecting);
          if (!firstFired) {
            firstFired = true;
          } else {
            setEnableTransition(true);
          }
        },
        { threshold: 0 }
      );
      intersectionObserver.observe(el);
    }

    const existing = document.querySelector(INLINE_FORM_SELECTOR);
    if (existing) {
      observeElement(existing);
    }

    mutationObserver = new MutationObserver(() => {
      const el = document.querySelector(INLINE_FORM_SELECTOR);
      if (el && el !== currentEl) {
        observeElement(el);
      } else if (!el && currentEl) {
        if (intersectionObserver) intersectionObserver.disconnect();
        currentEl = null;
        firstFired = false;
        setIsFormVisible(false);
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      intersectionObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [pathname]);

  return { isFormVisible, enableTransition };
}

export interface StickyCtaData {
  type: "sticky_cta";
  version?: string;
  heading: string;
  button_label?: string;
  show_dismiss?: boolean;
  /** Default false: hide until scrolled a few px. True: allow at page top. */
  show_at_top?: boolean | string;
  show_rigobot?: StickyShowRigobot | boolean;
  form?: LeadFormData;
}

interface StickyCallToActionProps {
  data: StickyCtaData;
  landingLocations?: string[];
}

function FormSkeleton() {
  return (
    <div className="animate-pulse p-4">
      <div className="h-8 w-48 bg-muted rounded mb-4" />
      <div className="space-y-3">
        <div className="h-10 w-full bg-muted rounded" />
        <div className="h-10 w-full bg-muted rounded" />
        <div className="h-10 w-full bg-muted rounded" />
      </div>
    </div>
  );
}

export function StickyCallToAction({ data, landingLocations }: StickyCallToActionProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const { isFormVisible: isHiddenByForm } = useInlineFormVisible();
  const isHiddenAtTop = useHiddenAtPageTop(data.show_at_top);
  const isHidden = isHiddenByForm || isHiddenAtTop;
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;

  const buttonLabel = data.button_label || "Apply Now";
  const rigobotClass = rigobotVisibilityClass(data.show_rigobot);

  if (isEditMode) {
    return (
      <div 
        className="w-full py-8 px-4"
        data-testid="sticky-cta-edit-placeholder"
      >
        <div className="max-w-4xl mx-auto border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 bg-muted/20">
          <div className="flex items-center justify-center gap-3 text-muted-foreground">
            <ChevronUp className="h-5 w-5" />
            <span className="text-sm font-medium">
              This section represents the sticky CTA bar that follows users at the bottom of the screen
            </span>
            <ChevronUp className="h-5 w-5" />
          </div>
          <div className="mt-4 flex items-center justify-center gap-4 text-sm">
            <span className="text-foreground font-medium">{data.heading}</span>
            <Button size="sm" disabled>
              {buttonLabel}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isDismissed) {
    return null;
  }

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 px-4 pt-2.5 pb-[calc(14px+env(safe-area-inset-bottom))]",
        "bg-background/95 backdrop-blur-md border-t shadow-[0_-8px_24px_hsl(var(--foreground)/0.08)]",
        "transition-[transform,opacity] duration-300 ease-out",
        isExpanded && "max-h-[80vh] overflow-auto",
        isHidden && "translate-y-[110%] opacity-0 pointer-events-none",
      )}
      aria-hidden={isHidden || undefined}
      data-testid="sticky-cta-bar"
    >
      {rigobotClass !== null && <RigobotPeek className={rigobotClass || undefined} />}
      {!isExpanded ? (
        <>
          <div className="relative flex items-center justify-center">
            <p
              className="m-0 flex items-center justify-center gap-2 text-sm text-muted-foreground"
              data-testid="text-sticky-cta-heading"
            >
              <span className="relative w-2 h-2 flex-shrink-0" aria-hidden="true">
                <span
                  className="absolute inset-0 rounded-full motion-safe:animate-ping [animation-duration:2.2s]"
                  style={{ background: "hsl(var(--color-green))" }}
                />
                <span className="absolute inset-0 rounded-full" style={{ background: "hsl(var(--color-green))" }} />
              </span>
              {data.heading}
            </p>
            {data.show_dismiss && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-0 h-8 w-8 text-muted-foreground"
                onClick={() => setIsDismissed(true)}
                aria-label="Dismiss"
                data-testid="sticky-cta-dismiss"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          <Button
            type="button"
            className="w-full h-[52px] text-base font-semibold"
            onClick={() => setIsExpanded(true)}
            tabIndex={isHidden ? -1 : undefined}
            data-testid="sticky-cta-expand-button"
          >
            <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.5} />
            {buttonLabel}
          </Button>
        </>
      ) : (
        <div className="w-full max-w-2xl mx-auto">
          <div className="flex items-center justify-between gap-2 mb-2">
            <p className="m-0 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="relative w-2 h-2 flex-shrink-0" aria-hidden="true">
                <span
                  className="absolute inset-0 rounded-full motion-safe:animate-ping [animation-duration:2.2s]"
                  style={{ background: "hsl(var(--color-green))" }}
                />
                <span className="absolute inset-0 rounded-full" style={{ background: "hsl(var(--color-green))" }} />
              </span>
              {data.heading}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => setIsExpanded(false)}
              data-testid="sticky-cta-collapse-button"
            >
              <ChevronDown className="h-4 w-4 mr-1" />
              Collapse
            </Button>
          </div>
          {data.form && (
            <Suspense fallback={<FormSkeleton />}>
              <LeadForm
                data={{
                  ...data.form,
                  variant: data.form.variant || "inline",
                  className: cn(data.form.className, "max-w-2xl mx-auto"),
                }}
              />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}

export default StickyCallToAction;
