export type EditorType =
  | "color-picker:background"
  | "image-picker"
  | "link-picker"
  | "boolean-toggle"
  | "rich-text-editor";

export const fieldEditors: Record<string, EditorType> = {
  title: "rich-text-editor",
  background: "color-picker:background",
  show_title_arrow: "boolean-toggle",
  "items[].host_avatar_url": "image-picker",
  "items[].cta_url": "link-picker",
  "items[].technology_image_ids[]": "image-picker",
};
