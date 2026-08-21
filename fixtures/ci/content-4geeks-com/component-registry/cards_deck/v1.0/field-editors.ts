/**
 * Field Editor Configuration for BulletTabsShowcase Component
 * 
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 * 
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "image-with-style-picker" | "link-picker"
 */

export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "image-with-style-picker" | "link-picker" | "video-picker" | "rich-text-editor";

export const fieldEditors: Record<string, EditorType> = {
  "cards[].video.url": "video-picker",
  "cards[].brand_image": "image-with-style-picker",
  "cards[].image": "image-with-style-picker",
  "subtitle": "rich-text-editor"
};
