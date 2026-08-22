import React from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OverlayActionButtons } from "./OverlayActionButtons";

vi.mock("@/components/InternalLink", () => ({
  InternalLink: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("OverlayActionButtons", () => {
  it("renders external destinations as real anchors (not SPA-only paths)", () => {
    const html = renderToStaticMarkup(
      <OverlayActionButtons
        onDismiss={() => {}}
        buttons={[
          {
            label: "I live in Florida",
            variant: "secondary",
            href: "https://fl.4geeksacademy.com",
          },
        ]}
      />,
    );

    expect(html).toContain('href="https://fl.4geeksacademy.com"');
    expect(html).toContain("I live in Florida");
    expect(html).toContain('data-testid="overlay-button-link-0"');
  });

  it("renders dismiss-only buttons without href when destination is empty", () => {
    const html = renderToStaticMarkup(
      <OverlayActionButtons
        onDismiss={() => {}}
        buttons={[{ label: "Close", variant: "outline", href: "" }]}
      />,
    );

    expect(html).toContain("Close");
    expect(html).toContain('data-testid="overlay-button-dismiss-0"');
    expect(html).not.toContain('href="');
  });
});
