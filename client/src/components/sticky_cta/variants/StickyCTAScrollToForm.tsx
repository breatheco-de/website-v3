// section-spacing: overlay
import { useCallback, useEffect, useState } from "react";
import { ChevronRight, ChevronUp } from "lucide-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import RigobotPeek from "@/components/custom-icons/RigobotPeek";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { cn } from "@/lib/utils";

interface StickyCtaScrollToFormData {
  type: "sticky_cta";
  version?: string;
  variant?: "scrollToForm";
  heading: string;
  button_label?: string;
  show_rigobot?: boolean;
  target_section_id?: string;
}

interface StickyCTAScrollToFormProps {
  data: StickyCtaScrollToFormData;
}

const FOCUS_DELAY_MS = 450;

function isRendered(el: Element) {
  return el.getClientRects().length > 0;
}

/** The form the button scrolls to: the target section's first visible form, else the page's first visible form. */
function findTargetForm(targetSectionId?: string): HTMLElement | null {
  const scope: ParentNode | null = targetSectionId ? document.getElementById(targetSectionId) : document;
  if (!scope) return null;
  const forms = Array.from(scope.querySelectorAll<HTMLElement>("form"));
  const visible = forms.find(isRendered);
  if (visible) return visible;
  return scope instanceof HTMLElement ? scope : null;
}

function useTargetForm(targetSectionId?: string) {
  const [pathname] = useLocation();
  const [form, setForm] = useState<HTMLElement | null>(null);
  const [formOnScreen, setFormOnScreen] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let current: HTMLElement | null = null;
    let intersection: IntersectionObserver | null = null;

    const attach = () => {
      const next = findTargetForm(targetSectionId);
      if (next === current) return;
      intersection?.disconnect();
      current = next;
      setForm(next);
      if (!next) {
        setFormOnScreen(false);
        setReady(true);
        return;
      }
      intersection = new IntersectionObserver(
        ([entry]) => {
          setFormOnScreen(entry.isIntersecting);
          setReady(true);
        },
        { threshold: 0.25 },
      );
      intersection.observe(next);
    };

    attach();
    const mutation = new MutationObserver(attach);
    mutation.observe(document.body, { childList: true, subtree: true });
    return () => {
      mutation.disconnect();
      intersection?.disconnect();
    };
  }, [pathname, targetSectionId]);

  return { form, hidden: !ready || formOnScreen, ready };
}

export default function StickyCTAScrollToForm({ data }: StickyCTAScrollToFormProps) {
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;
  const { form, hidden, ready } = useTargetForm(isEditMode ? undefined : data.target_section_id);
  const [animate, setAnimate] = useState(false);
  const buttonLabel = data.button_label || "Apply Now";

  useEffect(() => {
    if (!ready) return;
    const id = window.requestAnimationFrame(() => setAnimate(true));
    return () => window.cancelAnimationFrame(id);
  }, [ready]);

  const scrollToForm = useCallback(() => {
    if (!form) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    form.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    const firstField = form.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea");
    if (firstField) {
      window.setTimeout(() => firstField.focus({ preventScroll: true }), reduceMotion ? 0 : FOCUS_DELAY_MS);
    }
  }, [form]);

  if (isEditMode) {
    return (
      <div className="w-full py-8 px-4" data-testid="sticky-cta-edit-placeholder">
        <div className="max-w-md mx-auto border-2 border-dashed border-muted-foreground/30 rounded-lg p-6 bg-muted/20">
          <p className="flex items-center justify-center gap-2 text-sm font-medium text-muted-foreground text-center">
            <ChevronUp className="h-4 w-4 flex-shrink-0" />
            Mobile and tablet only: this bar sticks to the bottom and scrolls to the form
            {data.target_section_id ? ` in "${data.target_section_id}"` : ""}.
          </p>
          <p className="mt-4 text-center text-sm text-foreground">{data.heading}</p>
          <Button className="mt-2 w-full" disabled>
            <ChevronRight className="h-4 w-4" />
            {buttonLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-50 flex flex-col gap-2 px-4 pt-2.5 pb-[calc(14px+env(safe-area-inset-bottom))] lg:hidden",
        "bg-background/95 backdrop-blur-md border-t shadow-[0_-8px_24px_hsl(var(--foreground)/0.08)]",
        animate && "transition-[transform,opacity] duration-300 ease-out",
        hidden && "translate-y-[110%] opacity-0 pointer-events-none",
      )}
      aria-hidden={hidden || undefined}
      data-testid="sticky-cta-bar"
    >
      {data.show_rigobot && <RigobotPeek />}
      <p className="m-0 flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="text-sticky-cta-heading">
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
        type="button"
        className="w-full h-[52px] text-base font-semibold"
        onClick={scrollToForm}
        tabIndex={hidden ? -1 : undefined}
        data-testid="sticky-cta-scroll-button"
      >
        <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.5} />
        {buttonLabel}
      </Button>
    </div>
  );
}
