/**
 * Field Editor Configuration for Awards Marquee Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 *
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "link-picker"
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "title": "rich-text-editor",
  "title_above_carousel": "boolean-toggle",
  "items[].logo": "image-picker:logo",
  "items[].logoHeight": "text-input",
};
