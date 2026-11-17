/**
 * Micro-conversions for AI Flex Path: non-payment section clicks already
 * recorded via site-wide section-tracking (`cta_click`). Payment CTAs belong
 * on the Ecommerce tab once `tracking` is set — not listed here.
 */

export const microEvents = {
  "*": [
    {
      event: "cta_click",
      source: "section-tracking",
      label: "Non-payment button or link clicks",
    },
  ],
};
