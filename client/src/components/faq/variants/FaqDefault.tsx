import React from "react";
import { AlertTriangle, MessageCircle } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import type { FAQSection as FAQSectionType } from "@shared/schema";
import { useLocation as useWouterLocation } from "wouter";
import { useInternalNav } from "@/hooks/useInternalNav";
import { faqItemKey, normalizeFaqEntries, applyFaqHideOnLocations } from "@shared/faq-listing";
import { useSession } from "@/contexts/SessionContext";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { useLlmAudience } from "@/contexts/LlmAudienceContext";
import { RichTextContent } from "@/components/ui/rich-text-content";
import { inlineMarkdownToHtml } from "@/lib/inline-markdown";

interface FAQSectionProps {
  data: FAQSectionType;
}

export function FAQSection({ data }: FAQSectionProps) {
  const handleLinkClick = useInternalNav();
  const [pathname] = useWouterLocation();
  const { session } = useSession();
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;
  const llmAudience = useLlmAudience();
  const sessionLocationSlug = session.location?.slug;

  const locationSlugMatch = pathname.match(
    /^\/(en|es)\/(location|ubicacion)\/([^/]+)/,
  );
  const locationSlug = locationSlugMatch ? locationSlugMatch[3] : undefined;

  const itemOverrides = (data as Record<string, unknown>).item_overrides as
    | Record<string, { hideOnLocations?: string[] }>
    | undefined;

  const faqItems = (() => {
    const fromItems = normalizeFaqEntries(data.items);
    const fromHardcoded = normalizeFaqEntries(
      (data as Record<string, unknown>).hardcoded_entries,
    );

    // Prefer merged `items` from resolveDynamicEntries (hardcoded + DB).
    // If items is DB-only (bind resolved too late) but hardcoded_entries is a
    // real array, prepend unique hardcoded questions.
    let items: Array<{ question: string; answer: string }>;
    if (fromItems.length === 0) {
      items = fromHardcoded;
    } else if (fromHardcoded.length === 0) {
      items = fromItems;
    } else {
      const seen = new Set(fromItems.map((i) => faqItemKey(i.question)));
      const missingHardcoded = fromHardcoded.filter(
        (i) => !seen.has(faqItemKey(i.question)),
      );
      items = missingHardcoded.length > 0
        ? [...missingHardcoded, ...fromItems]
        : fromItems;
    }

    // AI crawler / LLM preview: no visitor campus — only the page's own campus
    // (location pages) filters questions; otherwise show every question.
    items = applyFaqHideOnLocations(
      items,
      itemOverrides,
      llmAudience ? locationSlug : locationSlug || sessionLocationSlug,
    );

    const dyn = (data as Record<string, unknown>).dynamic_entries as
      | { limit?: number }
      | undefined;
    const limit =
      typeof dyn?.limit === "number" && dyn.limit > 0 ? dyn.limit : undefined;
    if (limit != null) {
      items = items.slice(0, limit);
    }

    return items;
  })();

  if (faqItems.length === 0) {
    if (!isEditMode) return null;
    return (
      <section data-testid="section-faq-empty-edit" className="max-w-6xl mx-auto px-4">
        <div
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-foreground flex gap-3 items-start"
          data-testid="alert-faq-hidden-no-results"
        >
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="font-medium">
              {data.title ? `${data.title} — hidden on the live page` : "FAQ section — hidden on the live page"}
            </p>
            <p className="text-muted-foreground text-xs">
              This FAQ section is hidden on the live page because there are no results.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section data-testid="section-faq" className="max-w-6xl mx-auto px-4">
      <div className="max-w-6xl mx-auto px-4">
        <h2
          className="mb-8 text-center text-foreground text-[36px]"
          data-testid="text-faq-title"
        >
          {data.title}
        </h2>

        <div className="bg-background rounded-card border overflow-hidden">
          <Accordion type="single" collapsible>
            {faqItems.map((item, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="border-0 border-b last:border-b-0 px-6"
                data-testid={`accordion-faq-${index}`}
              >
                <AccordionTrigger
                  className="text-left font-medium text-foreground hover:no-underline py-4 text-base"
                  data-testid={`button-faq-${index}`}
                >
                  {item.question}
                </AccordionTrigger>
                <AccordionContent
                  className="text-muted-foreground pb-4 leading-relaxed"
                  data-testid={`text-faq-answer-${index}`}
                >
                  <RichTextContent
                    html={inlineMarkdownToHtml(item.answer)}
                    className="text-muted-foreground leading-relaxed"
                  />
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>

        {data.cta && (data.cta.text || data.cta.button) && (
          <div
            className="mt-12 text-center p-8 rounded-lg bg-muted/30 border"
            data-testid="faq-cta"
          >
            <div className="flex justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                <MessageCircle size={24} className="text-primary" />
              </div>
            </div>
            {data.cta.text && (
              <p className="text-lg text-foreground mb-4">{data.cta.text}</p>
            )}
            {data.cta.button && (
              <Button asChild data-testid="button-faq-cta">
                <a
                  href={data.cta.button.url}
                  onClick={handleLinkClick}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {data.cta.button.label}
                </a>
              </Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

export default FAQSection;
