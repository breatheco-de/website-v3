import { useMemo, useRef } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { createVariableWidgetPlugin } from "@/lib/cm-variable-highlight";
import { cn } from "@/lib/utils";

export interface TemplateCodeInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  testId?: string;
}

/**
 * One-line CodeMirror that looks like a code field and turns {{ … }} into the
 * same variable pills used in the section YAML editor.
 */
export function TemplateCodeInput({
  value,
  onChange,
  placeholder,
  className,
  testId,
}: TemplateCodeInputProps) {
  const valueRef = useRef(value);
  valueRef.current = value;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const extensions = useMemo(
    () => [
      Prec.highest(
        keymap.of([
          {
            key: "Enter",
            run: () => true,
          },
        ]),
      ),
      createVariableWidgetPlugin({
        onRequestUnbind: (span) => {
          const cur = valueRef.current;
          onChangeRef.current(cur.slice(0, span.from) + cur.slice(span.to));
        },
      }),
      ...(placeholder ? [cmPlaceholder(placeholder)] : []),
      EditorView.theme({
        "&": {
          fontSize: "12px",
          maxHeight: "32px",
          backgroundColor: "transparent",
        },
        "&.cm-focused": {
          outline: "none",
        },
        ".cm-scroller": {
          overflow: "hidden",
          fontFamily:
            "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
          lineHeight: "20px",
        },
        ".cm-content": {
          padding: "6px 8px",
          minHeight: "32px",
          caretColor: "hsl(var(--foreground))",
          color: "hsl(var(--foreground))",
        },
        ".cm-line": {
          padding: "0",
        },
        ".cm-placeholder": {
          color: "hsl(var(--muted-foreground))",
          fontStyle: "normal",
        },
      }),
    ],
    [placeholder],
  );

  return (
    <div
      className={cn(
        "flex-1 min-w-[10rem] rounded-md border border-input overflow-hidden bg-background",
        className,
      )}
      data-testid={testId}
    >
      <CodeMirror
        value={value}
        height="32px"
        extensions={extensions}
        onChange={onChange}
        basicSetup={{
          lineNumbers: false,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
          bracketMatching: true,
        }}
      />
    </div>
  );
}
