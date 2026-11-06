import { cn } from "@/lib/utils";

export type ResponsiveRichTextMobileMax = "md" | "lg";

export interface ResponsiveRichTextProps {
  html: string;
  className?: string;
  /**
   * Below this Tailwind breakpoint, override RTE inline font-size / line-height /
   * letter-spacing so parent sizing wins. Default: md (768px).
   */
  mobileMax?: ResponsiveRichTextMobileMax;
  /** Hide &lt;br&gt; below the mobile breakpoint (matches legacy stripTitleForMobile). */
  hideBrOnMobile?: boolean;
  "data-testid"?: string;
}

/**
 * Renders rich-text HTML once. Mobile vs desktop typography is CSS-only so
 * crawlers see a single textContent (no duplicated mobile/desktop nodes).
 */
export function ResponsiveRichText({
  html,
  className,
  mobileMax = "md",
  hideBrOnMobile = false,
  "data-testid": testId,
}: ResponsiveRichTextProps) {
  if (!html?.trim()) return null;

  return (
    <div
      className={cn(
        "rte-responsive",
        mobileMax === "lg" ? "rte-responsive--lg" : "rte-responsive--md",
        hideBrOnMobile && "rte-responsive--hide-br",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
      data-testid={testId}
    />
  );
}
