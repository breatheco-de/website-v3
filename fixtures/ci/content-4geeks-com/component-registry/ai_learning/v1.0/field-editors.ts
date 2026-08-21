export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "link-picker" | "cta-picker" | "rich-text-editor";

export const fieldEditors: Record<string, EditorType> = {
  "cta.url": "link-picker",
  "features[].cta": "cta-picker",
};
