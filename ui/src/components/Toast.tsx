import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

/**
 * Lightweight toast notifications — a fixed stack of cards (bottom-right)
 * with per-variant icons, auto-dismiss and an aria-live region. The API is
 * stable (useCallback/useMemo) so consumers can safely depend on it.
 *
 * `useToast` falls back to a no-op outside the provider so tests and
 * non-wired components never crash.
 */

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const noop = () => {};
const emptyToast: ToastApi = { success: noop, error: noop, info: noop };

const VARIANT_META = {
  success: { icon: CheckCircle2, iconClass: "text-success" },
  error: { icon: AlertTriangle, iconClass: "text-danger" },
  info: { icon: Info, iconClass: "text-secondary" },
} as const;

const DISMISS_AFTER_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = ++nextIdRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      window.setTimeout(() => dismiss(id), DISMISS_AFTER_MS);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push(message, "success"),
      error: (message) => push(message, "error"),
      info: (message) => push(message, "info"),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2"
        role="region"
        aria-label={t("common.notifications")}
      >
        {toasts.map((item) => {
          const meta = VARIANT_META[item.variant];
          const Icon = meta.icon;
          return (
            <div
              key={item.id}
              role="status"
              className={cn(
                "janosik-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-popover p-3 shadow-lg shadow-black/10",
                item.variant === "error"
                  ? "border-danger/30"
                  : "border-border/80",
              )}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.iconClass)} />
              <p className="flex-1 text-sm leading-snug text-foreground">
                {item.message}
              </p>
              <button
                onClick={() => dismiss(item.id)}
                aria-label={t("common.dismissNotification")}
                className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-hover hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  return ctx ?? emptyToast;
}
