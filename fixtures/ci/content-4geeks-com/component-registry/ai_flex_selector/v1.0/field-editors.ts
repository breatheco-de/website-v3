export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "default:icon": "icon-picker",
  "default:title": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "default:title_highlight": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "default:tools_marquee": "boolean-toggle",
  "default:cta.banner": "boolean-toggle",
  "default:cta.buttons[]": "cta-picker",
};
