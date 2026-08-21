export type EditorType = "icon-picker" | "color-picker" | "image-picker:logo" | "image-with-style-picker" | "link-picker" | "boolean-toggle" | "rich-text-editor";

export const fieldEditors: Record<string, EditorType> = {
  "tabs[].col1_boxes[].icon": "icon-picker",
  "tabs[].col1_description": "rich-text-editor",
  "tabs[].col2_bullets[].icon": "icon-picker",
  "tabs[].col3_image_id": "image-with-style-picker",
  "tabs[].right_bullets[].icon": "icon-picker",
  "tabs[].left_image_id": "image-with-style-picker",
  "tabs[].right_logos[].image_id": "image-picker:logo",
  "tabs[].left_bullets[].icon": "icon-picker",
  "tabs[].left_description": "rich-text-editor",
  "tabs[].right_image_id": "image-with-style-picker",
  "tabs[].testimonials[].image_id": "image-with-style-picker",
  "tabs[].testimonials[].description": "rich-text-editor",
  "tabs[].testimonials[].contributor_logos[].image_id": "image-picker:logo",
};
