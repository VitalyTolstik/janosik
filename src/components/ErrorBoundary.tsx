import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n";

/**
 * Error boundary — catches render errors below it and shows a branded,
 * theme-aware fallback instead of a blank screen. Placed above the page
 * content but inside the i18n/theme providers so the fallback itself can
 * use the app's own tokens and translations.
 */

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The technical details stay in the console only — the fallback screen
    // never exposes the raw error to end users.
    console.error("Janosik crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error !== null) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}

function ErrorFallback() {
  const { t } = useI18n();

  const handleReset = () => {
    // Wipe only the app's own data, then reload.
    try {
      const keys = Object.keys(localStorage).filter(
        (key) => key.startsWith("janosik-") || key.startsWith("vortex-"),
      );
      for (const key of keys) localStorage.removeItem(key);
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-border/70 bg-card p-7 text-center shadow-xl">
        <div className="relative mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-sm">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden
          >
            <path
              d="M14.086 18.412A2 2 0 0112.67 19H5v-7.672a2 2 0 01.586-1.414L11.75 3.75a6 6 0 118.49 8.49z"
              fill="currentColor"
            />
            <path
              d="M16 8 2 22"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <div className="space-y-1.5">
          <h1 className="font-display text-lg font-semibold tracking-tight">
            {t("error.title")}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("error.description")}
          </p>
        </div>
        <div className="flex justify-center gap-2">
          <Button onClick={() => window.location.reload()}>
            <RotateCcw className="h-4 w-4" />
            {t("error.reload")}
          </Button>
          <Button
            variant="outline"
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={handleReset}
          >
            <Trash2 className="h-4 w-4" />
            {t("error.reset")}
          </Button>
        </div>
      </div>
    </div>
  );
}
