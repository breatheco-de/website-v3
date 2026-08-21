export type EditorType =
  | "icon-picker"
  | "color-picker"
  | "color-picker:background"
  | "color-picker:text"
  | "image-picker"
  | "link-picker"
  | "boolean-toggle"
  | "select"
  | "rich-text-editor";

export const fieldEditors: Record<string, EditorType> = {
  "title": "rich-text-editor",
  "default_box_color": "color-picker",
  "default_title_color": "color-picker",
  "default_excerpt_color": "color-picker",
  "default_link_color": "color-picker",
  "title_color": "color-picker",
  "subtitle_color": "color-picker",
  "badge_color": "color-picker",
  "badge_text_color": "color-picker:text",
  "background": "color-picker:background",
  "featured_background": "color-picker:background",
  "cards_background": "color-picker:background",
  "show_links": "boolean-toggle",
  "show_logos": "boolean-toggle",
  "clamp_excerpts": "boolean-toggle",
  "variant": "select",
  "items[].box_color": "color-picker",
  "items[].title_color": "color-picker",
  "items[].excerpt_color": "color-picker",
  "items[].link_color": "color-picker",
  "items[].logo": "image-picker",
  "items[].link_url": "link-picker",
};
