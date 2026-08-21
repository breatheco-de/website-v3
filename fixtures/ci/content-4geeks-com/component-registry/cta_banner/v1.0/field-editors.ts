/**
 * Field Editor Configuration for CTA Banner Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 *
 * Note: The 'variant' field is handled directly in SectionEditorPanel.tsx
 * with a dedicated VariantPicker component for cta_banner sections.
 *
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "link-picker"
 *                   | "variant-picker" | "rich-text-editor" | "cta-picker" | "form-settings"
 */

export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "link-picker" | "variant-picker" | "rich-text-editor" | "form-settings" | "cta-picker";

export const fieldEditors: Record<string, EditorType> = {
  // ── default / form variants ──────────────────────────────────────────
  "form_background": "color-picker",
  "terms_color": "color-picker",
  "buttons[].button_variant": "variant-picker",
  "buttons[].text_color": "color-picker:text" as EditorType,
  "buttons[].url": "link-picker",
  "cta_url": "link-picker",
  "form": "form-settings",

  // ── strip variant ────────────────────────────────────────────────────
  "strip:text": "rich-text-editor",
  "strip:icon": "icon-picker",
  "strip:cta_buttons[]": "cta-picker",

  // ── resourceShowcase variant ─────────────────────────────────────────
  "resourceShowcase:title": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight" as EditorType,
  "resourceShowcase:preview.image": "image-picker",
  "resourceShowcase:preview.icon": "icon-picker",
  "resourceShowcase:benefits[].icon": "icon-picker",
  "resourceShowcase:form": "form-settings",

  // ── promotion variant ────────────────────────────────────────────────
  "promotion:title": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight" as EditorType,
  "promotion:cta_buttons[]": "cta-picker",
};
