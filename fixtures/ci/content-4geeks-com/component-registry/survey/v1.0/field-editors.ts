export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "default:icon": "icon-picker",
  "default:image_id": "image-picker",
  "default:title": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "default:title_highlight": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "default:aggregation_method": "string-picker:concat,sum",
  "default:questions[].options[].action.url": "link-picker:allow-inline-render",
  "default:routes.*.url": "link-picker:allow-inline-render",
  "default:routes.thresholds[].url": "link-picker:allow-inline-render",
  "default:routes.fallback.url": "link-picker:allow-inline-render",
  "default:alternate_link.url": "link-picker:allow-inline-render",
};
