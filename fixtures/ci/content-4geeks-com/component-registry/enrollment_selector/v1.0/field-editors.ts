/**
 * Field editors for enrollment_selector.
 * cta-tracking binds ecommerce CTA intent editors (Ecommerce tab inventory).
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "programs[].summary.cta": "cta-tracking",
  "programs[].plans[].summary.cta": "cta-tracking",
  "default:title": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "default:programs[].selection_card.icon": "icon-picker",
  "default:programs[].benefits[].icon": "icon-picker",
  "default:programs[].unlocks[].icon": "icon-picker",
  "default:programs[].summary.cta": "cta-picker",
  "default:programs[].summary.rows[].value": "rich-text-editor",
  "default:programs[].summary.rows[].value_with_addon": "rich-text-editor",
  "default:programs[].summary.trust_note.image_id": "image-picker",
  "default:programs[].dates.items[].url": "link-picker",
  "default:programs[].dates.items[].badges[].color": "color-picker:courses",
  "default:programs[].dates.items[].tags[].color": "color-picker:courses",
  "default:programs[].dates.url": "link-picker",
  "default:programs[].plans[].summary.cta": "cta-picker",
  "default:programs[].plans[].summary.rows[].value": "rich-text-editor",
  "default:programs[].plans[].summary.rows[].value_with_addon": "rich-text-editor",
  "default:programs[].plans[].summary.trust_note.image_id": "image-picker",
  "default:programs[].plans[].benefits[].icon": "icon-picker",
  "default:programs[].plans[].unlocks[].icon": "icon-picker",
  "default:programs[].query_component.items[].icon": "icon-picker",
  "default:programs[].query_component.items[].color": "color-picker:courses",
  "default:programs[].query_component.items[].bullets[].icon": "icon-picker",
};
