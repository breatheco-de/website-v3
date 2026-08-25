import {
  ViewPlugin,
  Decoration,
  WidgetType,
  EditorView,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import {
  RangeSet,
  type Range,
  EditorState,
  type Extension,
} from "@codemirror/state";
import type {
  TemplateUnbindContext,
  TemplateUnbindDefinition,
} from "@shared/templateUnbind";

const variablePattern = /\{\{\s*([^|}]+?)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;

export interface TemplateSpan {
  from: number;
  to: number;
  expr: string;
  name: string;
}

export interface VariableWidgetPluginOptions {
  getDefinitions?: () => Record<string, TemplateUnbindDefinition>;
  getContext?: () => TemplateUnbindContext;
  onRequestUnbind?: (detail: TemplateSpan) => void;
  readOnly?: boolean;
}

function findTemplateSpans(text: string): TemplateSpan[] {
  const spans: TemplateSpan[] = [];
  let match: RegExpExecArray | null;
  variablePattern.lastIndex = 0;
  while ((match = variablePattern.exec(text)) !== null) {
    spans.push({
      from: match.index,
      to: match.index + match[0].length,
      expr: match[0],
      name: match[1].trim(),
    });
  }
  return spans;
}

function spansOverlap(
  spans: TemplateSpan[],
  from: number,
  to: number,
): boolean {
  return spans.some((s) => from < s.to && to > s.from);
}

/**
 * Locate where `originalText` should be replaced with a template.
 * Prefers explicit selection offsets when they still match; otherwise finds the
 * first occurrence that does not sit inside an existing `{{ ... }}` span
 * (so e.g. selecting "category" in a URL does not hit `single.category`).
 */
export function findReplaceableTextRange(
  doc: string,
  originalText: string,
  selectionFrom?: number,
  selectionTo?: number,
): { from: number; to: number } | null {
  if (!originalText) return null;

  if (
    selectionFrom !== undefined &&
    selectionTo !== undefined &&
    selectionFrom >= 0 &&
    selectionTo <= doc.length &&
    selectionFrom < selectionTo &&
    doc.slice(selectionFrom, selectionTo) === originalText
  ) {
    return { from: selectionFrom, to: selectionTo };
  }

  const spans = findTemplateSpans(doc);
  let searchFrom = 0;
  while (searchFrom <= doc.length - originalText.length) {
    const pos = doc.indexOf(originalText, searchFrom);
    if (pos === -1) return null;
    const to = pos + originalText.length;
    if (!spansOverlap(spans, pos, to)) {
      return { from: pos, to };
    }
    searchFrom = pos + 1;
  }
  return null;
}

class VariablePillWidget extends WidgetType {
  constructor(
    private readonly span: TemplateSpan,
    private readonly onUnbind: () => void,
    private readonly readOnly: boolean,
  ) {
    super();
  }

  eq(other: VariablePillWidget): boolean {
    return (
      other.span.from === this.span.from &&
      other.span.to === this.span.to &&
      other.span.expr === this.span.expr
    );
  }

  toDOM(): HTMLElement {
    const pill = document.createElement("span");
    pill.className = "cm-variable-pill";
    pill.title =
      "Template binding — value comes from entry data. Click × to replace with static text.";

    const label = document.createElement("span");
    label.className = "cm-variable-pill-label";
    label.textContent = this.span.name;
    pill.appendChild(label);

    if (!this.readOnly) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cm-variable-pill-remove";
      btn.setAttribute("aria-label", "Replace binding with static text");
      btn.textContent = "×";
      btn.addEventListener("mousedown", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onUnbind();
      });
      pill.appendChild(btn);
    }

    return pill;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(
  view: EditorView,
  options: VariableWidgetPluginOptions,
): { decorations: DecorationSet; spans: TemplateSpan[] } {
  const text = view.state.doc.toString();
  const spans = findTemplateSpans(text);
  const ranges: Range<Decoration>[] = [];

  for (const span of spans) {
    ranges.push(
      Decoration.replace({
        widget: new VariablePillWidget(
          span,
          () => options.onRequestUnbind?.(span),
          !!options.readOnly,
        ),
        inclusive: false,
      }).range(span.from, span.to),
    );
  }

  return {
    decorations: ranges.length > 0 ? RangeSet.of(ranges, true) : Decoration.none,
    spans,
  };
}

export function createVariableWidgetPlugin(
  options: VariableWidgetPluginOptions,
): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      spans: TemplateSpan[] = [];

      constructor(view: EditorView) {
        const built = buildDecorations(view, options);
        this.decorations = built.decorations;
        this.spans = built.spans;
      }

      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) {
          const built = buildDecorations(update.view, options);
          this.decorations = built.decorations;
          this.spans = built.spans;
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (pluginInstance) =>
        EditorView.atomicRanges.of((view) => {
          const instance = view.plugin(pluginInstance);
          if (!instance) return Decoration.none;
          const ranges: Range<Decoration>[] = instance.spans.map((s) =>
            Decoration.mark({ class: "cm-variable-atomic" }).range(s.from, s.to),
          );
          return ranges.length > 0 ? RangeSet.of(ranges, true) : Decoration.none;
        }),
    },
  );

  const changeFilter = EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged) return true;
    const oldSpans = findTemplateSpans(tr.startState.doc.toString());
    if (oldSpans.length === 0) return true;

    let allowed = true;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      if (!allowed) return;
      const removedLength = toA - fromA;
      const insertedLength = inserted.length;
      for (const span of oldSpans) {
        const overlaps = fromA < span.to && toA > span.from;
        if (!overlaps) continue;
        const removesWholeSpan = fromA <= span.from && toA >= span.to;
        if (!removesWholeSpan && insertedLength !== removedLength) {
          allowed = false;
        }
      }
    });
    return allowed;
  });

  const keymap = EditorView.domEventHandlers({
    keydown(event, view) {
      if (options.readOnly) return false;
      if (event.key !== "Backspace" && event.key !== "Delete") return false;

      const { from, to } = view.state.selection.main;
      const text = view.state.doc.toString();
      const spans = findTemplateSpans(text);

      if (!from && to === text.length && spans.length > 0) {
        return false;
      }

      const selectedSpan = spans.find(
        (s) =>
          (from === to && from >= s.from && from <= s.to) ||
          (from <= s.from && to >= s.to),
      );

      if (!selectedSpan) return false;

      event.preventDefault();
      options.onRequestUnbind?.(selectedSpan);
      return true;
    },
  });

  return [plugin, changeFilter, keymap];
}

/** @deprecated Use createVariableWidgetPlugin */
export const variableHighlightPlugin = createVariableWidgetPlugin({});

export { findTemplateSpans, spansOverlap };
