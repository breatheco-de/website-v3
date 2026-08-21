/**
 * Field Editor Configuration for ValueProofPanel Component
 * 
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 * 
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "image-with-style-picker" | "link-picker"
 */

export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "image-with-style-picker" | "link-picker";

export const fieldEditors: Record<string, EditorType> = {
  "media.src": "image-with-style-picker",
  "evidence_items[].icon": "icon-picker",
};
