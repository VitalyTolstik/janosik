import { Component, type ErrorInfo, type ReactNode } from "react";
import { Download, RotateCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { BoardState } from "@janosik/shared";
import { serializeExport } from "@janosik/shared";
import { downloadTextFile, timestampedFilename } from "@/utils/download";
import { readRaw } from "@/utils/storage";
import { BOARD_STORAGE_KEY } from "@janosik/shared";

/**
 * Error boundary — catches render errors below it and shows a branded,
 * theme-aware fallback instead of a blank screen.
 *
 * The fallback is deliberately self-contained: **hardcoded English, no
 * i18n, no Radix dialog**. It renders after something below has already
 * crashed, and the crash may well have come from the i18n or dialog layer
 * itself — an error thrown inside a fallback has no boundary left to catch
 * it and takes the whole page down with it. The confirmation step is
 * therefore inlined rather than reusing `ConfirmDialog` (TASK-21.2).
 *
 * Resetting is destructive, so it is gated twice over: an explicit
 * confirmation, and a JSON copy of the stored boards downloaded *before*
 * anything is erased.
 */

const APP_KEY_PREFIXES = ["janosik-", "vortex-"];
/** Give the browser a moment to start the download before the page reloads. */
const RELOAD_DELAY_MS = 400;

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * Inline fallback for a subtree (the card dialog, TASK-151/C11): a crash
   * there must not replace the whole app with the reset screen.
   */
  compact?: boolean;
  /**
   * Reset the boundary when this value changes (TASK-156): a compact
   * fallback must not stay pinned for the next card/dialog.
   */
  resetKey?: unknown;
  /**
   * The compact fallback's close action (TASK-156 review): the fallback
   * used to be unclosable — the only way out was reloading the page.
   * The boundary clears its error and calls this; the owner removes what
   * crashed (BoardSection closes the card and clears its URL param).
   * Without it the fallback keeps offering the reload only.
   */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
  confirmingReset: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, confirmingReset: false };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // The technical details stay in the console only — the fallback screen
    // never exposes the raw error to end users.
    console.error("Janosik crashed:", error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (
      this.state.error !== null &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ error: null, confirmingReset: false });
    }
  }

  render() {
    if (this.state.error !== null) {
      if (this.props.compact === true) {
        return (
          <CompactFallback
            onReset={
              this.props.onReset === undefined
                ? undefined
                : () => {
                    this.setState({ error: null, confirmingReset: false });
                    this.props.onReset?.();
                  }
            }
          />
        );
      }
      return (
        <ErrorFallback
          confirmingReset={this.state.confirmingReset}
          onConfirmingResetChange={(confirmingReset) =>
            this.setState({ confirmingReset })
          }
        />
      );
    }
    return this.props.children;
  }
}

/** Small, self-contained fallback for a section/dialog subtree. */
function CompactFallback({ onReset }: { onReset?: () => void }) {
  return (
    <div
      role="alert"
      data-testid="error-compact"
      className="m-auto flex max-w-xs flex-col items-center gap-3 rounded-xl border border-border/70 bg-card p-5 text-center text-sm shadow-lg"
    >
      <p className="text-muted-foreground">
        This section hit an unexpected error.
      </p>
      <div className="flex items-center justify-center gap-2">
        {onReset !== undefined ? (
          <Button
            variant="outline"
            data-testid="error-compact-close"
            onClick={onReset}
          >
            Close
          </Button>
        ) : null}
        <Button onClick={() => window.location.reload()}>
          <RotateCcw className="h-4 w-4" />
          Reload
        </Button>
      </div>
    </div>
  );
}

/**
 * Download whatever is stored before it is erased: a regular Janosik export
 * (re-importable from the data menu) when the boards still parse, otherwise
 * the raw text as-is — damaged data is still data.
 */
function downloadDataBeforeReset(): void {
  const raw = readRaw(BOARD_STORAGE_KEY);
  if (raw === null) return;
  let payload = raw;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) payload = serializeExport(parsed as BoardState);
  } catch {
    /* unparsable — fall through and dump the raw text unchanged */
  }
  downloadTextFile(timestampedFilename("janosik-before-reset"), payload);
}

/** Wipe the app's own keys (nothing else) and reload. */
function resetAppData(): void {
  try {
    const keys = Object.keys(localStorage).filter((key) =>
      APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix)),
    );
    for (const key of keys) localStorage.removeItem(key);
  } catch {
    /* storage unreachable — the reload below is still the best next step */
  }
  window.setTimeout(() => window.location.reload(), RELOAD_DELAY_MS);
}

function ErrorFallback({
  confirmingReset,
  onConfirmingResetChange,
}: {
  confirmingReset: boolean;
  onConfirmingResetChange: (confirming: boolean) => void;
}) {
  const handleReset = () => {
    downloadDataBeforeReset();
    resetAppData();
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
        {confirmingReset ? (
          <>
            <div className="space-y-1.5">
              <h1 className="font-display text-lg font-semibold tracking-tight">
                Erase local data?
              </h1>
              <p className="text-sm text-muted-foreground">
                Your boards are replaced by the starter board. A JSON copy is
                downloaded first — you can import it back from the data menu.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button
                variant="outline"
                onClick={() => onConfirmingResetChange(false)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                data-testid="error-reset-confirm"
                onClick={handleReset}
              >
                <Download className="h-4 w-4" />
                Save a copy &amp; erase
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-1.5">
              <h1 className="font-display text-lg font-semibold tracking-tight">
                Something went wrong
              </h1>
              <p className="text-sm text-muted-foreground">
                Janosik hit an unexpected error. Reload the app, or reset the
                local data — a copy is downloaded before anything is erased.
              </p>
            </div>
            <div className="flex justify-center gap-2">
              <Button onClick={() => window.location.reload()}>
                <RotateCcw className="h-4 w-4" />
                Reload
              </Button>
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                data-testid="error-reset"
                onClick={() => onConfirmingResetChange(true)}
              >
                <Trash2 className="h-4 w-4" />
                Reset data
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
