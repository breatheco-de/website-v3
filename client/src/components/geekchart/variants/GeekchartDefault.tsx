import { useEffect, useRef } from "react";
import { Geekchart } from "geekchart";
import { playInView } from "geekchart/observe";
import type { GeekchartSection } from "@shared/schema";

interface GeekchartSectionProps {
  data: GeekchartSection;
}

/**
 * `html` is not part of chartSectionSchema — it is added server-side by
 * server/markdown-enhance.ts's enhanceGeekchartSection right before the page is
 * sent, same rendering geekchart does for a ```mermaid fence inside an
 * article. Empty when the source failed to render (logged server-side).
 */
type GeekchartSectionWithHtml = GeekchartSection & { html?: string };

export function GeekchartDefault({ data }: GeekchartSectionProps) {
  const { caption, html } = data as GeekchartSectionWithHtml;
  const rootRef = useRef<HTMLDivElement>(null);

  // Charts ship paused (`play: 'in-view'`) and start once scrolled into view,
  // same as an in-article chart (see ArticleDefault.tsx).
  useEffect(() => {
    if (!html) return;
    return playInView(rootRef.current ?? document);
  }, [html]);

  // No server-enhanced html (the Component Gallery's example preview, a
  // screenshot job, a page rendered outside the enhancement path): draw in
  // the browser with the component instead of showing nothing.
  const body = html ? (
    <div dangerouslySetInnerHTML={{ __html: html }} />
  ) : data.source ? (
    <Geekchart source={data.source} play="once" duration={data.duration ?? undefined} />
  ) : null;
  if (!body) return null;

  return (
    <div
      ref={rootRef}
      className="w-full px-4 py-8 md:px-6 lg:px-8"
      data-testid="section-geekchart"
    >
      <figure className="geekchart mx-auto max-w-3xl">
        {body}
        {caption && (
          <figcaption
            className="mt-3 text-center text-sm text-muted-foreground"
            data-testid="text-geekchart-caption"
          >
            {caption}
          </figcaption>
        )}
      </figure>
    </div>
  );
}

export default GeekchartDefault;
