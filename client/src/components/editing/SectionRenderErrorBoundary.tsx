import React, { Component, type ErrorInfo, type ReactNode, useState } from "react";
import { AlertTriangle, ChevronDown, FileCode } from "lucide-react";
import { Button } from "@/components/ui/button";

type FallbackProps = {
  sectionType?: string;
  sectionId?: string;
  error: Error;
  onEditYaml?: () => void;
  onRetry: () => void;
};

/** Exported for static markup tests (error boundaries need a client tree). */
export function SectionRenderErrorFallback({
  sectionType,
  sectionId,
  error,
  onEditYaml,
  onRetry,
}: FallbackProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div
      className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 md:p-6 my-2"
      data-testid="section-render-error"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              This section failed to render
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              The rest of the page is still here. Edit YAML to fix this section, then reload.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {onEditYaml && (
              <Button
                type="button"
                size="sm"
                variant="default"
                onClick={onEditYaml}
                data-testid="button-section-error-edit-yaml"
              >
                <FileCode className="h-4 w-4 mr-1.5" />
                Edit YAML
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={onRetry}
              data-testid="button-section-error-retry"
            >
              Try again
            </Button>
          </div>
          <div>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setAdvancedOpen((v) => !v)}
              data-testid="button-section-error-advanced"
            >
              {advancedOpen ? "Hide details" : "Read more (advanced)"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {advancedOpen && (
              <div
                className="mt-2 rounded-md border border-border bg-card p-3 space-y-1 text-left"
                data-testid="section-render-error-advanced"
              >
                {sectionType && (
                  <p className="text-xs font-mono text-foreground">type: {sectionType}</p>
                )}
                {sectionId && (
                  <p className="text-xs font-mono text-foreground">section_id: {sectionId}</p>
                )}
                <p className="text-xs font-mono text-muted-foreground whitespace-pre-wrap break-words">
                  {error.message}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  children: ReactNode;
  sectionType?: string;
  sectionId?: string;
  onEditYaml?: () => void;
};

type State = {
  error: Error | null;
};

/**
 * Per-section boundary so one throw does not blank the whole preview.
 * Staff can open Edit YAML from the fallback card when `onEditYaml` is provided.
 */
export class SectionRenderErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[SectionRenderErrorBoundary]", error, info.componentStack);
  }

  private handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <SectionRenderErrorFallback
          sectionType={this.props.sectionType}
          sectionId={this.props.sectionId}
          error={error}
          onEditYaml={this.props.onEditYaml}
          onRetry={this.handleRetry}
        />
      );
    }
    return this.props.children;
  }
}
