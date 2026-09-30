import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface WorkbenchErrorBoundaryProps {
  children: ReactNode;
}

interface WorkbenchErrorBoundaryState {
  error: Error | null;
}

export class WorkbenchErrorBoundary extends Component<
  WorkbenchErrorBoundaryProps,
  WorkbenchErrorBoundaryState
> {
  state: WorkbenchErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): WorkbenchErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[workbench] panel render failed", error, info);
    try {
      window.localStorage.setItem(
        "magic-workbench-last-ui-error",
        JSON.stringify({
          capturedAt: new Date().toISOString(),
          message: error.message,
          stack: error.stack ?? null,
          componentStack: info.componentStack ?? null,
        }),
      );
    } catch {
      return;
    }
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs">
        <p className="font-semibold text-destructive">Workbench panel error</p>
        <p className="mt-1 break-words text-muted-foreground">
          {this.state.error.message}
        </p>
        <p className="mt-2 text-[10px] text-muted-foreground">
          The game board is still active. Completed deck-test results remain saved locally.
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-3 h-8 px-2 text-[11px]"
          onClick={() => this.setState({ error: null })}
        >
          Retry Workbench panel
        </Button>
      </section>
    );
  }
}
