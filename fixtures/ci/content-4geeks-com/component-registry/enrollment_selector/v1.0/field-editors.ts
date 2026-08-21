/**
 * Field editors for enrollment_selector.
 * cta-tracking binds ecommerce CTA intent editors (Ecommerce tab inventory).
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "programs[].summary.cta": "cta-tracking",
  "programs[].plans[].summary.cta": "cta-tracking",
};
