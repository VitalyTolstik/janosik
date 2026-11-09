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
}

export interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const noop = () => {};
const emptyToast: ToastApi = { success: noop, error: noop, info: noop };

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
  // Pending auto-dismiss timers. Tracked so unmount can clear them — an
  // orphaned timer fires after the environment is torn down and `dismiss`
  // then touches a gone `window` (`ReferenceError: window is not defined`).
  const timersRef = useRef(new Set<number>());

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (message: string, variant: ToastVariant) => {
      const id = ++nextIdRef.current;
      setToasts((prev) => [...prev, { id, message, variant }]);
      const timer = window.setTimeout(() => {
        timersRef.current.delete(timer);
        dismiss(id);
      }, DISMISS_AFTER_MS);
      timersRef.current.add(timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      timers.clear();
    };
  }, []);

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
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
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
                onClick: () => dismiss(item.id),
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
