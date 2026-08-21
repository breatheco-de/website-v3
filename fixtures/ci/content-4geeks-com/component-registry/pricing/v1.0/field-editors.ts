/**
 * Field Editor Configuration for Pricing Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 *
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "link-picker"
 */

export type EditorType =
  | "icon-picker"
  | "color-picker"
  | "image-picker"
  | "link-picker"
  | "rich-text-editor"
  | "boolean-toggle"

export const fieldEditors: Record<string, EditorType> = {
  "features[].icon": "icon-picker",
  "static_icons": "boolean-toggle",
  "cta.url": "link-picker",
  "plan_cards:title": "rich-text-editor",
  "plan_cards:plans[].cta.url": "link-picker",
  "plan_cards:plans[].featured": "boolean-toggle",
};
