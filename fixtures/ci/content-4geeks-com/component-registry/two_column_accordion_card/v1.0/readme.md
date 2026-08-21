# Two Column Accordion Card

A versatile card-based section that combines descriptive content with expandable accordion items alongside an image.

## Use Cases

- Feature explanations with detailed descriptions
- FAQ-style content with expandable answers
- Product/service highlights with supporting visuals
- Course benefits or program details

## Layout

The component uses a 7:5 column ratio on desktop:
- **Content column (7/12)**: Contains title, description, accordion items, and optional footer
- **Image column (5/12)**: Displays a single image with subtle background

On mobile, columns stack vertically with content first.

## Properties

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| type | string | Yes | Must be `two_column_accordion_card` |
| version | string | No | Schema version |
| title | string | No | Main heading |
| description | string | No | Introductory paragraph |
| bullets | array | No | Accordion items (heading + text) |
| footer | string | No | Italicized footer text |
| image | string | No | Image URL |
| image_alt | string | No | Image alt text |
| reverse | boolean | No | Flip image to left side |

## Accordion Behavior

- First item is expanded by default
- Only one item can be open at a time (single mode)
- Click header to toggle open/closed

## Example

```yaml
type: two_column_accordion_card
title: "Learn With Support"
description: "Our support system includes:"
bullets:
  - heading: "24/7 Mentorship"
    text: "Get help whenever you need it from experienced developers."
  - heading: "AI Assistant"
    text: "Instant answers to common questions and code reviews."
image: "/images/support-team.png"
image_alt: "Support team helping students"
```
