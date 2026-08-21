/**
 * Field Editor Configuration for Hero Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 *
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "link-picker"
 *
 * Variant-specific fields use the format: "variantName:fieldPath"
 * Example: "productShowcase:left_images[].src" only applies to productShowcase variant
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  // Global - applies to all variants that have this field
  "signup_card.features[].icon": "icon-picker",
  "signup_card.cta_button.text": "text-input",
  "signup_card.cta_button.url": "link-picker",
  "signup_card.cta_button.variant": "string-picker:primary,secondary,outline",
  "course:signup_card.cta_button": "cta-tracking",
  "signup_card.cta_button.icon": "icon-picker",
  "orbit:title": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "orbit:body": "rich-text-editor",

  // Variant-specific - prefixed with variant name
  "productShowcase:image": "image-with-style-picker",
  "productShowcase:left_images[].src": "image-picker",
  "productShowcase:right_images[].src": "image-picker",
  "productShowcase:marquee.items[].logo": "image-picker:logo",
  "productShowcase:marquee.items[].logoHeight": "text-input",
  "showcase:left_images[].src": "image-picker",
  "showcase:right_images[].src": "image-picker",
  "showcase:cta_button.text": "text-input",
  "showcase:cta_button.url": "link-picker",
  "showcase:cta_button.variant": "string-picker:primary,secondary,outline" as EditorType,
  "showcase:cta_button.icon": "icon-picker",
  "simpleTwoColumn:image": "image-with-style-picker",
  "simpleTwoColumn:subtitle": "rich-text-editor",
  "singleColumn:title": "rich-text-editor",
  "singleColumn:subtitle": "rich-text-editor",
  "singleColumn:image.src": "image-picker",
  "course:layout_reversed": "boolean-toggle",
  "course:badge.text": "text-input",
  "course:badge.background": "color-picker",
  "course:badge.text_color": "color-picker:text",
  "course:description": "rich-text-editor",
  "course:signup_card.login_link.text": "rich-text-editor",
  "course:video.url": "video-picker",
  "productShowcase:video.url": "video-picker",
  "simpleTwoColumn:video.url": "video-picker",
  "ApplyFormProductShowcase:video.url": "video-picker",
  "ApplyFormProductShowcase:image": "image-with-style-picker",
  "productShowcase:form_vertical_align": "string-picker:top,center,bottom" as EditorType,
  "ApplyFormProductShowcase:form_vertical_align": "string-picker:top,center,bottom" as EditorType,
  "productShowcase:title": "rich-text-editor",
  "productShowcase:brand_mark.prefix": "rich-text-editor",
  "productShowcase:brand_mark.highlight": "rich-text-editor",
  "productShowcase:brand_mark.suffix": "rich-text-editor",
  "productShowcase:description": "rich-text-editor",
  "productShowcase:footer": "rich-text-editor",
  "ApplyFormProductShowcase:brand_mark.suffix": "rich-text-editor",
  "ApplyFormProductShowcase:description": "rich-text-editor",
  "ApplyFormProductShowcase:footer": "rich-text-editor",
  "productShowcase:show_awards_marquee": "boolean-toggle",
  "ApplyFormProductShowcase:show_awards_marquee": "boolean-toggle",
  "productShowcase:awards_marquee.items[].logo": "image-picker:logo",
  "ApplyFormProductShowcase:awards_marquee.items[].logo": "image-picker:logo",
  "productShowcase:form_card_background": "color-picker",
  "ApplyFormProductShowcase:form_card_background": "color-picker",
  "productShowcase:form_card_image": "image-with-style-picker",
  "ApplyFormProductShowcase:form_card_image": "image-with-style-picker",
  "productShowcase:form_card_subtitle": "rich-text-editor",
  "productShowcase:form_card_text_color": "color-picker:text",
  "productShowcase:form_terms_color": "color-picker",
  "productShowcase:awards_marquee_at_left_column": "boolean-toggle",
  "ApplyFormProductShowcase:form_terms_color": "color-picker",
  "ApplyFormProductShowcase:cta_button.text": "text-input",
  "ApplyFormProductShowcase:cta_button.url": "link-picker",
  "ApplyFormProductShowcase:cta_button.variant": "string-picker:primary,secondary,outline" as EditorType,
  "ApplyFormProductShowcase:cta_button.icon": "icon-picker",

  // credibility variant
  "credibility:title": "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "credibility:description": "rich-text-editor",
  "credibility:show_marquee": "boolean-toggle",
  "credibility:marquee_static": "boolean-toggle",
  "credibility:colored_logos": "boolean-toggle",
  "credibility:pills[].logos[].image_id": "image-picker:logo",
  "credibility:pills[].background_color": "color-picker",
  "credibility:pills_url": "link-picker",
  "productShowcase:form": "form-settings",
  "ApplyFormProductShowcase:form": "form-settings",
  "course:signup_card.form": "form-settings",

  // exercise variant
  "exercise:description": "rich-text-editor",
  "exercise:features[].icon": "icon-picker",
  "exercise:stats[].icon": "icon-picker",
  "exercise:form": "form-settings",
  "exercise:form_card_image": "image-with-style-picker",
};
