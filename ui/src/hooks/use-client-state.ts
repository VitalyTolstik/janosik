import { useEffect, useState } from "react";

/**
 * Small, read-only hooks describing the client the panel is running in — the
 * "state of the UI" that the backend cannot report: the service worker, the
 * install mode and the connection. All are SSR/jsdom-safe and degrade to a
 * neutral value when the API is unavailable.
 */

export type ServiceWorkerStatus =
  "unsupported" | "unregistered" | "installing" | "active";

/** Whether the PWA service worker is registered, installing or controlling. */
export function useServiceWorkerStatus(): ServiceWorkerStatus {
  const [status, setStatus] = useState<ServiceWorkerStatus>(() =>
    typeof navigator === "undefined" || !("serviceWorker" in navigator)
      ? "unsupported"
      : "unregistered",
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    let active = true;
    navigator.serviceWorker
      .getRegistration()
      .then((registration) => {
        if (!active) return;
        setStatus(
          registration?.active
            ? "active"
            : registration?.installing
              ? "installing"
              : "unregistered",
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  return status;
}

const STANDALONE_QUERY = "(display-mode: standalone)";

/** True when the app runs as an installed PWA rather than a browser tab. */
export function useStandalone(): boolean {
  const [standalone, setStandalone] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(STANDALONE_QUERY).matches
      : false,
  );

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    )
      return;
    const media = window.matchMedia(STANDALONE_QUERY);
    const onChange = () => setStandalone(media.matches);
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  return standalone;
}

/** Live `navigator.onLine` — an offline-first app cares about the connection. */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}
