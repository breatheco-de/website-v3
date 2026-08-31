import { createContext, useContext, useRef, useLayoutEffect as _useLayoutEffect, useState, useEffect } from "react";
import { Braces } from "lucide-react";
import type { ReactNode, CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { EditorView } from "@codemirror/view";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import {
  resolveVariable,
  type VariableDefinition,
  type VariableContext as VarCtx,
} from "@/lib/variable-manager";
import { isEntryOrSingleVarName } from "@shared/entryTemplateVars";
import { VariableDetailModal } from "./VariableDetailModal";
import { VariableTypeChooserModal } from "./VariableTypeChooserModal";
import { SingleVariablePickerModal } from "./SingleVariablePickerModal";
import { SingleVariableDetailModal } from "./SingleVariableDetailModal";
import { Button } from "@/components/ui/button";

// On the server renderToString doesn't support useLayoutEffect — use useEffect instead
const useLayoutEffect = typeof window !== "undefined" ? _useLayoutEffect : useEffect;

interface VariableHighlightContextValue {
  definitions: Record<string, VariableDefinition>;
  context: VarCtx;
  isEditMode: boolean;
  contentType?: string;
}

const VariableHighlightContext = createContext<VariableHighlightContextValue | null>(null);

const TEMPLATE_REGEX = /\{\{\s*([^|}]+?)\s*(?:\|\s*([\s\S]*?))?\s*\}\}/g;

const VARIABLE_CLICK_EVENT = "variable-highlight-click";
const VARIABLE_CREATE_EVENT = "variable-create-from-selection";

interface VariableClickDetail {
  variableName: string;
  inlineDefault: string;
  contentType?: string;
}

interface VariableCreateDetail {
  selectedText: string;
  sectionIndex: number;
  selectionFrom?: number;
  selectionTo?: number;
  contentType?: string;
  singleEntry?: Record<string, unknown>;
}

function highlightDomVariables(
  container: HTMLElement,
  definitions: Record<string, VariableDefinition>,
  context: VarCtx,
  isEditMode: boolean,
  contentType?: string,
): (() => void) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const el = node.parentElement as HTMLElement | null;
      if (el?.closest?.("[data-var-react-owner]") || el?.closest?.(".variable-highlight-react")) {
        return NodeFilter.FILTER_SKIP;
      }
      const text = node.textContent || "";
      TEMPLATE_REGEX.lastIndex = 0;
      if (TEMPLATE_REGEX.test(text)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    },
  });

  const textNodes: Text[] = [];
  let node: Node | null;
  while ((node = walker.nextNode())) {
    textNodes.push(node as Text);
  }

  const replacements: { span: HTMLSpanElement; original: string }[] = [];

  for (const textNode of textNodes) {
    const text = textNode.textContent || "";
    const fragment = document.createDocumentFragment();
    let lastEnd = 0;

    TEMPLATE_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = TEMPLATE_REGEX.exec(text)) !== null) {
      if (match.index > lastEnd) {
        fragment.appendChild(document.createTextNode(text.slice(lastEnd, match.index)));
      }

      const varName = match[1].trim();
      const inlineDefault = match[2]?.trim() || "";
      const result = resolveVariable(varName, definitions, context);
      const resolvedValue = result?.value || inlineDefault || varName;
      const source = result?.source || (inlineDefault ? "inline" : "unresolved");

      const span = document.createElement("span");
      span.className = "variable-highlight-dom";
      span.textContent = resolvedValue;
      span.dataset.variableName = varName;
      span.dataset.variableSource = source;
      span.dataset.variableDefault = inlineDefault;
      span.dataset.testid = `variable-highlight-${varName}`;

      if (isEditMode) {
        span.style.backgroundColor = "rgba(250, 204, 21, 0.3)";
        span.style.outline = "2px solid rgb(239, 68, 68)";
        span.style.outlineOffset = "1px";
        span.style.borderRadius = "3px";
        span.style.cursor = "pointer";
        span.title = `Click to inspect {{ ${varName} }}`;

        span.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.dispatchEvent(
            new CustomEvent<VariableClickDetail>(VARIABLE_CLICK_EVENT, {
              detail: { variableName: varName, inlineDefault, contentType },
            }),
          );
        });
      } else {
        span.style.textDecoration = "underline";
        span.style.textDecorationStyle = "dotted";
        span.style.textDecorationColor = "rgb(139, 92, 246)";
        span.style.textDecorationThickness = "2px";
        span.style.textUnderlineOffset = "3px";
        span.style.cursor = "help";
        span.title = `{{ ${varName} }}\nSource: ${source}${inlineDefault ? `\nDefault: ${inlineDefault}` : ""}`;
      }

      replacements.push({ span, original: match[0] });
      fragment.appendChild(span);
      lastEnd = match.index + match[0].length;
    }

    if (lastEnd < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
    }

    textNode.parentNode?.replaceChild(fragment, textNode);
  }

  return () => {
    for (const { span, original } of replacements) {
      if (span.parentNode) {
        span.parentNode.replaceChild(document.createTextNode(original), span);
      }
    }
  };
}

function SelectionFloatingButton({
  sectionIndex,
  contentType,
  singleEntry,
}: {
  sectionIndex: number;
  contentType?: string;
  singleEntry?: Record<string, unknown>;
}) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const [selectedText, setSelectedText] = useState("");
  /** Captured while the selection is alive — click clears DOM selection before handlers run. */
  const selectionRangeRef = useRef<{
    text: string;
    from?: number;
    to?: number;
    sectionIndex: number;
  } | null>(null);
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;

  useEffect(() => {
    if (!isEditMode) {
      setPosition(null);
      selectionRangeRef.current = null;
      return;
    }

    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.toString().trim()) {
        // Keep last range + button: mousedown on the floating control clears
        // window selection before click; we still need the captured offsets.
        return;
      }

      const anchor = selection.anchorNode;
      const cmEditor = anchor?.parentElement?.closest(".cm-editor") as HTMLElement | null;
      if (!cmEditor) {
        setPosition(null);
        setSelectedText("");
        selectionRangeRef.current = null;
        return;
      }

      const sectionAttr = cmEditor.closest("[data-section-index]")?.getAttribute("data-section-index");
      if (sectionAttr !== null && sectionAttr !== undefined && Number(sectionAttr) !== sectionIndex) {
        setPosition(null);
        setSelectedText("");
        selectionRangeRef.current = null;
        return;
      }

      let from: number | undefined;
      let to: number | undefined;
      let cmText: string | undefined;
      try {
        const view = EditorView.findFromDOM(cmEditor);
        if (view) {
          const mainSel = view.state.selection.main;
          if (!mainSel.empty) {
            from = mainSel.from;
            to = mainSel.to;
            cmText = view.state.sliceDoc(from, to);
          }
        }
      } catch {
        /* ignore */
      }

      const text = (cmText || selection.toString()).trim();
      if (text.length < 2 || text.length > 500) {
        setPosition(null);
        selectionRangeRef.current = null;
        return;
      }

      if (/\{\{.*\}\}/.test(text)) {
        setPosition(null);
        selectionRangeRef.current = null;
        return;
      }

      // If we trimmed whitespace, shrink CM offsets to the trimmed slice.
      if (
        cmText !== undefined &&
        from !== undefined &&
        to !== undefined &&
        cmText !== text
      ) {
        const lead = cmText.length - cmText.trimStart().length;
        const trail = cmText.length - cmText.trimEnd().length;
        from = from + lead;
        to = to - trail;
      }

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();

      const resolvedSectionIndex =
        sectionAttr !== null && sectionAttr !== undefined
          ? Number(sectionAttr)
          : sectionIndex;

      selectionRangeRef.current = {
        text,
        from,
        to,
        sectionIndex: resolvedSectionIndex,
      };
      setSelectedText(text);
      setPosition({
        top: rect.top + window.scrollY - 40,
        left: rect.left + window.scrollX + rect.width / 2,
      });
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [isEditMode, sectionIndex]);

  const handleClick = (e: ReactMouseEvent) => {
    // Preserve captured range; default mousedown/click would clear window selection.
    e.preventDefault();
    e.stopPropagation();

    const captured = selectionRangeRef.current;
    const textToUse = captured?.text || selectedText;
    if (!textToUse) return;

    window.dispatchEvent(
      new CustomEvent<VariableCreateDetail>(VARIABLE_CREATE_EVENT, {
        detail: {
          selectedText: textToUse,
          sectionIndex: captured?.sectionIndex ?? sectionIndex,
          selectionFrom: captured?.from,
          selectionTo: captured?.to,
          contentType,
          singleEntry,
        },
      }),
    );
    window.getSelection()?.removeAllRanges();
    selectionRangeRef.current = null;
    setPosition(null);
    setSelectedText("");
  };

  if (!position || !isEditMode) return null;

  return createPortal(
    <div
      style={{
        position: "absolute",
        top: position.top,
        left: position.left,
        transform: "translateX(-50%)",
        zIndex: 9999,
      }}
      data-testid="button-convert-to-variable"
    >
      <Button
        size="sm"
        variant="default"
        onMouseDown={(e) => {
          // Prevent clearing the CodeMirror selection before we read it.
          e.preventDefault();
        }}
        onClick={handleClick}
        className="shadow-lg whitespace-nowrap gap-1.5"
      >
        <Braces className="w-3.5 h-3.5" />
        Convert to variable
      </Button>
    </div>,
    document.body,
  );
}

export function VariableHighlightProvider({
  children,
  sectionIndex,
  contentType,
  hasSingleVars,
  singleEntry,
}: {
  children: ReactNode;
  variables?: unknown[];
  sectionIndex: number;
  contentType?: string;
  hasSingleVars?: boolean;
  singleEntry?: Record<string, unknown>;
}) {
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;
  const { data: definitions } = useVariableDefinitions();
  const varContext = useVariableContext();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  const contextValue = {
    definitions: definitions || {},
    context: varContext,
    isEditMode,
    contentType,
  };

  const rescanRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observerRef = useRef<MutationObserver | null>(null);

  const hasVars = hasSingleVars || (definitions != null && Object.keys(definitions).length > 0);

  const observeContainer = () => {
    if (!wrapperRef.current || observerRef.current) return;
    const observer = new MutationObserver(() => {
      if (rescanRef.current) clearTimeout(rescanRef.current);
      rescanRef.current = setTimeout(() => {
        if (!wrapperRef.current || !hasVars) return;
        if (observerRef.current) {
          observerRef.current.disconnect();
          observerRef.current = null;
        }
        if (cleanupRef.current) {
          cleanupRef.current();
          cleanupRef.current = null;
        }
        cleanupRef.current = highlightDomVariables(
          wrapperRef.current!,
          definitions || {},
          varContext,
          isEditMode,
          contentType,
        );
        requestAnimationFrame(() => observeContainer());
      }, 150);
    });
    observer.observe(wrapperRef.current, {
      childList: true,
      subtree: true,
    });
    observerRef.current = observer;
  };

  useLayoutEffect(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    if (!wrapperRef.current || !hasVars) {
      return;
    }
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    cleanupRef.current = highlightDomVariables(
      wrapperRef.current,
      definitions || {},
      varContext,
      isEditMode,
      contentType,
    );
    requestAnimationFrame(() => observeContainer());

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (rescanRef.current) {
        clearTimeout(rescanRef.current);
        rescanRef.current = null;
      }
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [definitions, varContext, isEditMode, children, observeContainer, hasVars]);

  return (
    <VariableHighlightContext.Provider value={contextValue}>
      <div ref={wrapperRef} style={{ display: "contents" }}>
        {children}
      </div>
      <SelectionFloatingButton sectionIndex={sectionIndex} contentType={contentType} singleEntry={singleEntry} />
    </VariableHighlightContext.Provider>
  );
}

function extractSlugFromUrl(): string | undefined {
  const path = window.location.pathname;
  const segments = path.split("/").filter(Boolean);
  if (segments.length >= 2) {
    return segments[segments.length - 1];
  }
  return undefined;
}

export function VariableModalHost() {
  const [modalState, setModalState] = useState<{
    variableName: string;
    inlineDefault: string;
    mode: "inspect" | "create";
    sectionIndex: number;
    selectionFrom?: number;
    selectionTo?: number;
    contentType?: string;
    singleEntry?: Record<string, unknown>;
  }>({ variableName: "", inlineDefault: "", mode: "inspect", sectionIndex: -1 });

  const [activeModal, setActiveModal] = useState<"chooser" | "global" | "single" | "single-detail" | null>(null);

  const modalStateRef = useRef(modalState);
  modalStateRef.current = modalState;

  useEffect(() => {
    const handleClick = (e: Event) => {
      const detail = (e as CustomEvent<VariableClickDetail>).detail;
      const isSingleVar = isEntryOrSingleVarName(detail.variableName);
      setModalState({
        variableName: detail.variableName,
        inlineDefault: detail.inlineDefault,
        mode: "inspect",
        sectionIndex: -1,
        contentType: detail.contentType,
      });
      setActiveModal(isSingleVar && detail.contentType ? "single-detail" : "global");
    };

    const handleCreate = (e: Event) => {
      const detail = (e as CustomEvent<VariableCreateDetail>).detail;
      setModalState({
        variableName: "",
        inlineDefault: detail.selectedText,
        mode: "create",
        sectionIndex: detail.sectionIndex,
        selectionFrom: detail.selectionFrom,
        selectionTo: detail.selectionTo,
        contentType: detail.contentType,
        singleEntry: detail.singleEntry,
      });
      if (detail.contentType) {
        setActiveModal("chooser");
      } else {
        setActiveModal("global");
      }
    };

    window.addEventListener(VARIABLE_CLICK_EVENT, handleClick);
    window.addEventListener(VARIABLE_CREATE_EVENT, handleCreate);
    return () => {
      window.removeEventListener(VARIABLE_CLICK_EVENT, handleClick);
      window.removeEventListener(VARIABLE_CREATE_EVENT, handleCreate);
    };
  }, []);

  const handleCreated = (variableName: string, templateSyntax: string) => {
    const current = modalStateRef.current;

    setModalState((prev) => ({
      ...prev,
      variableName,
      mode: "inspect",
    }));
    setActiveModal("global");

    if (current.sectionIndex < 0 || !current.inlineDefault) return;

    window.dispatchEvent(
      new CustomEvent("variable-created-replace", {
        detail: {
          sectionIndex: current.sectionIndex,
          originalText: current.inlineDefault,
          templateSyntax,
          selectionFrom: current.selectionFrom,
          selectionTo: current.selectionTo,
        },
      }),
    );
  };

  const handleSingleCreated = (variableName: string, templateSyntax: string) => {
    const current = modalStateRef.current;
    setActiveModal(null);

    if (current.sectionIndex < 0 || !current.inlineDefault) return;

    window.dispatchEvent(
      new CustomEvent("variable-created-replace", {
        detail: {
          sectionIndex: current.sectionIndex,
          originalText: current.inlineDefault,
          templateSyntax,
          selectionFrom: current.selectionFrom,
          selectionTo: current.selectionTo,
        },
      }),
    );
  };

  const handleChooserChoice = (type: "global" | "single") => {
    setActiveModal(type);
  };

  return (
    <>
      <VariableDetailModal
        open={activeModal === "global"}
        onOpenChange={(open) => { if (!open) setActiveModal(null); }}
        variableName={modalState.variableName}
        inlineDefault={modalState.inlineDefault}
        mode={modalState.mode}
        onCreated={handleCreated}
      />
      <VariableTypeChooserModal
        open={activeModal === "chooser"}
        onOpenChange={(open) => { if (!open) setActiveModal(null); }}
        contentType={modalState.contentType || ""}
        onChoose={handleChooserChoice}
      />
      <SingleVariablePickerModal
        open={activeModal === "single"}
        onOpenChange={(open) => { if (!open) setActiveModal(null); }}
        contentType={modalState.contentType || ""}
        inlineDefault={modalState.inlineDefault}
        singleEntry={modalState.singleEntry}
        onCreated={handleSingleCreated}
      />
      <SingleVariableDetailModal
        open={activeModal === "single-detail"}
        onOpenChange={(open) => { if (!open) setActiveModal(null); }}
        variableName={modalState.variableName}
        inlineDefault={modalState.inlineDefault}
        contentType={modalState.contentType || ""}
        currentSlug={extractSlugFromUrl()}
      />
    </>
  );
}

export function useVariableText() {
  const ctx = useContext(VariableHighlightContext);

  return (text: ReactNode, _path?: string): ReactNode => {
    if (typeof text !== "string") return text;

      TEMPLATE_REGEX.lastIndex = 0;
      if (!TEMPLATE_REGEX.test(text)) return text;

      const definitions = ctx?.definitions || {};
      const context = ctx?.context || {};
      const isEditMode = ctx?.isEditMode ?? false;
      const ctxContentType = ctx?.contentType;
      const hasDefs = Object.keys(definitions).length > 0;

      const parts: ReactNode[] = [];
      let lastEnd = 0;
      let key = 0;
      TEMPLATE_REGEX.lastIndex = 0;
      let match: RegExpExecArray | null;

      while ((match = TEMPLATE_REGEX.exec(text)) !== null) {
        if (match.index > lastEnd) {
          parts.push(text.slice(lastEnd, match.index));
        }

        const varName = match[1].trim();
        const inlineDefault = match[2]?.trim() || "";
        const result = hasDefs ? resolveVariable(varName, definitions, context) : null;
        const resolvedValue = result?.value || inlineDefault || varName;
        const source = result?.source || (inlineDefault ? "inline" : "unresolved");

        const style: CSSProperties = isEditMode
          ? {
              backgroundColor: "rgba(250, 204, 21, 0.3)",
              outline: "2px solid rgb(239, 68, 68)",
              outlineOffset: "1px",
              borderRadius: "3px",
              cursor: "pointer",
            }
          : {
              textDecoration: "underline",
              textDecorationStyle: "dotted" as const,
              textDecorationColor: "rgb(139, 92, 246)",
              textDecorationThickness: "2px",
              textUnderlineOffset: "3px",
              cursor: "help",
            };

        const title = isEditMode
          ? `Click to inspect {{ ${varName} }}`
          : `{{ ${varName} }}\nSource: ${source}${inlineDefault ? `\nDefault: ${inlineDefault}` : ""}`;

        const handleClick = isEditMode
          ? (e: ReactMouseEvent) => {
              e.preventDefault();
              e.stopPropagation();
              window.dispatchEvent(
                new CustomEvent<VariableClickDetail>(VARIABLE_CLICK_EVENT, {
                  detail: { variableName: varName, inlineDefault, contentType: ctxContentType },
                }),
              );
            }
          : undefined;

        parts.push(
          <span
            key={`vr-${key++}`}
            className="variable-highlight-react"
            data-variable-name={varName}
            data-variable-source={source}
            data-variable-default={inlineDefault}
            data-testid={`variable-highlight-${varName}`}
            style={style}
            title={title}
            onClick={handleClick}
          >
            {resolvedValue}
          </span>,
        );

        lastEnd = match.index + match[0].length;
      }

      if (lastEnd < text.length) {
        parts.push(text.slice(lastEnd));
      }

      return parts.length === 1 ? parts[0] : <>{parts}</>;
  };
}
