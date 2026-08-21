export type EditorType =
  | "icon-picker"
  | "color-picker"
  | "color-picker:accent"
  | "image-picker"
  | "link-picker"
  | "rich-text-editor"
  | "boolean-toggle"
  | "string-picker:grid,stacked_list,spotlight_with_list";

export const fieldEditors: Record<string, EditorType> = {
  layout: "string-picker:grid,stacked_list,spotlight_with_list",
  show_salary: "boolean-toggle",
  "programs[].description": "rich-text-editor",
  "programs[].icon": "icon-picker",
  "programs[].badge_icon": "icon-picker",
  "programs[].color": "color-picker:accent",
  "programs[].cta_url": "link-picker",
  "programs[].cta.url": "link-picker",
};
