/**
 * Field Editor Configuration for ImageRow Component
 * 
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 * 
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "image-with-style-picker" | "link-picker" | "rich-text-editor"
 */

export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "image-with-style-picker" | "link-picker" | "rich-text-editor" | "boolean-toggle";

export const fieldEditors: Record<string, EditorType> = {
  "images[].src": "image-with-style-picker",
  "highlight.text_1": "rich-text-editor",
  "highlight.text_2": "rich-text-editor",
  "highlight.slides[].text_1": "rich-text-editor",
  "highlight.slides[].text_2": "rich-text-editor",
  "highlight.reverse_text_order": "boolean-toggle"
};
