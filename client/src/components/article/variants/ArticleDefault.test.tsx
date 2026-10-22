import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { parseHTML } from "linkedom";

vi.mock("wouter", () => ({
  useLocation: () => ["/en/test", vi.fn()],
}));

const MARKER = "<!--article-html-v1-->";
const chart = (id: string) =>
  `${MARKER}<p>Intro</p><figure class="geekchart"><div id="${id}"><div><svg class="gc-chart" data-gc-play="in-view"></svg></div></div></figure>`;

type Mod = typeof import("./ArticleDefault");
type Root = import("react-dom/client").Root;

let MarkdownRenderer: Mod["MarkdownRenderer"];
let createRoot: typeof import("react-dom/client").createRoot;
let root: Root | null = null;

beforeAll(async () => {
  // react-dom decides whether a DOM exists when it is first imported.
  const { window, document } = parseHTML("<!doctype html><html><body></body></html>");
  // vitest compiles JSX with the classic runtime; the component file has no React import.
  Object.assign(globalThis, {
    React,
    window,
    document,
    HTMLElement: window.HTMLElement,
    Node: window.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  // Node 20 has no global navigator; Node 21+ defines a getter-only one.
  if (typeof globalThis.navigator === "undefined") {
    Object.assign(globalThis, { navigator: { userAgent: "Node.js" } });
  }
  ({ createRoot } = await import("react-dom/client"));
  ({ MarkdownRenderer } = await import("./ArticleDefault"));
});

afterEach(() => {
  React.act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function mount(ui: React.ReactElement) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  React.act(() => root!.render(ui));
  return (next: React.ReactElement) => React.act(() => root!.render(next));
}

const svgIn = (id: string) => document.querySelector(`#${id} svg`) as Element | null;

describe("MarkdownRenderer geekchart playback", () => {
  it("marks an in-article chart as playing once mounted", () => {
    mount(<MarkdownRenderer content={chart("gc-a")} />);
    expect(svgIn("gc-a")?.hasAttribute("data-gc-playing")).toBe(true);
  });

  it("keeps the same playing chart when the article re-renders with the same content", () => {
    const rerender = mount(<MarkdownRenderer content={chart("gc-a")} idPrefix="" />);
    const before = svgIn("gc-a");

    // A changed idPrefix forces a real re-render of the markdown tree.
    rerender(<MarkdownRenderer content={chart("gc-a")} idPrefix="article-1--" />);

    const after = svgIn("gc-a");
    expect(after).toBe(before);
    expect(before?.isConnected).toBe(true);
    expect(after?.hasAttribute("data-gc-playing")).toBe(true);
  });

  it("mounts a fresh playing chart when the content changes", () => {
    const rerender = mount(<MarkdownRenderer content={chart("gc-a")} />);
    const before = svgIn("gc-a");

    rerender(<MarkdownRenderer content={chart("gc-b")} />);

    const after = svgIn("gc-b");
    expect(after).not.toBeNull();
    expect(after).not.toBe(before);
    expect(before?.isConnected).toBe(false);
    expect(after?.hasAttribute("data-gc-playing")).toBe(true);
  });

  it("dedupes repeated heading ids the same way the table of contents does", () => {
    mount(
      <MarkdownRenderer
        content={"## Overview\n\ntext\n\n## Overview\n\nmore"}
        idPrefix="a--"
      />,
    );
    const ids = Array.from(document.querySelectorAll("h2")).map((h) => h.id);
    expect(ids).toEqual(["a--overview", "a--overview-1"]);
  });
});
