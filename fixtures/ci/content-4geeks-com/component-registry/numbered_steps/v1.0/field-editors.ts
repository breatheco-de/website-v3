/**
 * Field Editor Configuration for NumberedSteps Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "cta_button.text": "text-input",
  "cta_button.url": "link-picker",
  "cta_button.variant": "string-picker:primary,secondary,outline",
  "cta_button.icon": "icon-picker",
};
