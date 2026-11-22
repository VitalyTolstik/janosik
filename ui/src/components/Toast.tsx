import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  type LucideIcon,
} from "lucide-react";

import { Notice, type NoticeTone } from "@/components/notifications/Notice";
import { useI18n } from "@/i18n";

/**
 * Lightweight toast notifications — a fixed stack of glass cards
 * (bottom-right) with per-variant icons, auto-dismiss and an aria-live
 * region. The API is stable (useCallback/useMemo) so consumers can safely
 * depend on it.
 *
 * `useToast` falls back to a no-op outside the provider so tests and
 * non-wired components never crash.
 */

type ToastVariant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
  /** Opt-in key: one visible toast per key (TASK-182.1). */
  key?: string;
}

export interface ToastOptions {
  key?: string;
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  /** Remove the keyed toast and cancel its timer (TASK-182.1). */
  clear: (key: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const noop = () => {};
const emptyToast: ToastApi = {
  success: noop,
  error: noop,
  info: noop,
  clear: noop,
};

const VARIANT_META: Record<
  ToastVariant,
  { icon: LucideIcon; tone: NoticeTone }
> = {
  success: { icon: CheckCircle2, tone: "success" },
  error: { icon: AlertTriangle, tone: "danger" },
  info: { icon: Info, tone: "info" },
};

const DISMISS_AFTER_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  // Pending auto-dismiss timers, keyed by toast id. Tracked so unmount can
  // clear them — an orphaned timer fires after the environment is torn down
  // and `remove` then touches a gone `window` (`ReferenceError`).
  const timersRef = useRef(new Map<number, number>());
  // Active key -> toast id and toast id -> key, kept in step by push/remove.
  const keyedRef = useRef(new Map<string, number>());
  const toastKeysRef = useRef(new Map<number, string>());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const remove = useCallback(
    (id: number) => {
      clearTimer(id);
      const key = toastKeysRef.current.get(id);
      if (key !== undefined) {
        toastKeysRef.current.delete(id);
        if (keyedRef.current.get(key) === id) keyedRef.current.delete(key);
      }
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    },
    [clearTimer],
  );

  const clear = useCallback(
    (key: string) => {
      const id = keyedRef.current.get(key);
      if (id !== undefined) remove(id);
    },
    [remove],
  );

  const push = useCallback(
    (message: string, variant: ToastVariant, options?: ToastOptions) => {
      const key = options?.key;
      // A keyed toast is a fresh item: remove the previous one (and its timer)
      // so the live region sees a removal/insertion and re-announces identical
      // text. Unkeyed toasts stay additive.
      if (key !== undefined) {
        const existing = keyedRef.current.get(key);
        if (existing !== undefined) remove(existing);
      }
      const id = ++nextIdRef.current;
      setToasts((prev) => [...prev, { id, message, variant, key }]);
      const timer = window.setTimeout(() => {
        timersRef.current.delete(id);
        remove(id);
      }, DISMISS_AFTER_MS);
      timersRef.current.set(id, timer);
      if (key !== undefined) {
        keyedRef.current.set(key, id);
        toastKeysRef.current.set(id, key);
      }
    },
    [remove],
  );

  useEffect(() => {
    const timers = timersRef.current;
    const keyed = keyedRef.current;
    const toastKeys = toastKeysRef.current;
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      keyed.clear();
      toastKeys.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message, options) => push(message, "success", options),
      error: (message) => push(message, "error"),
      info: (message) => push(message, "info"),
      clear,
    }),
    [push, clear],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-[calc(1rem_+_env(safe-area-inset-bottom))] right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        role="region"
        aria-label={t("common.notifications")}
      >
        {toasts.map((item) => {
          const meta = VARIANT_META[item.variant];
          return (
            <Notice
              key={item.id}
              tone={meta.tone}
              icon={meta.icon}
              body={item.message}
              bodyClassName="text-foreground"
              role="status"
              live="polite"
              animate={false}
              className="janosik-toast pointer-events-auto"
              close={{
                onClick: () => remove(item.id),
                label: t("common.dismissNotification"),
              }}
            />
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
