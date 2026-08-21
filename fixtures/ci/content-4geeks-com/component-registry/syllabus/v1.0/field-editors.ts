/**
 * Field Editor Configuration for ImageRow Component
 * 
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 * 
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "image-with-style-picker" | "link-picker"
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "tech_logos[]": "icon-picker",
  "cta_button.text": "text-input",
  "cta_button.url": "link-picker",
  "cta_button.variant": "string-picker:primary,secondary,outline",
  "cta_button.icon": "icon-picker",
};
