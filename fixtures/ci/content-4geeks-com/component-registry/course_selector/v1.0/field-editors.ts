export type EditorType = "icon-picker" | "color-picker:courses" | "color-picker:accent" | "image-picker" | "link-picker" | "rich-text-editor";

export const fieldEditors: Record<string, EditorType> = {
  "subheading": "rich-text-editor",
  "courses[].icon": "icon-picker",
  "courses[].badges[].icon": "icon-picker",
  "courses[].tags[].icon": "icon-picker",
  "courses[].price_info": "rich-text-editor",
  "courses[].cta_url": "link-picker",

  "default:courses[].course_background":  "color-picker:courses",
  "solid:courses[].course_background": "color-picker:accent",
  "spotlight:courses[].course_background": "color-picker:courses"
};
