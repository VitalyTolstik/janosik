/**
 * Privacy-friendly, dependency-free event tracking for the marketing site.
 *
 * The site ships no third-party analytics by default — nothing leaves the
 * browser until a provider is configured (`PUBLIC_ANALYTICS_DOMAIN` /
 * `PUBLIC_ANALYTICS_SRC`, see `Analytics.astro`). This module only defines the
 * event vocabulary and forwards events to whatever sink happens to be present
 * (`dataLayer`, Plausible, Umami). No cookies, no personal data, and Do Not
 * Track is honoured.
 */

/** Event properties are flat and PII-free by convention. */
export type EventProps = Record<string, string | number | boolean>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    plausible?: (event: string, options?: { props?: EventProps }) => void;
    umami?: { track: (event: string, props?: EventProps) => void };
  }
}

/** The `dataLayer` payload for an event — object shape, one object per event. */
export function buildPayload(event: string, props: EventProps = {}) {
  return { event, ...props };
}

/** Tracking is skipped when the visitor has Do Not Track enabled. */
export function shouldTrack(doNotTrack: string | null | undefined): boolean {
  return doNotTrack !== "1";
}

/** Fire a named event at every configured sink. Safe to call on the server. */
export function track(event: string, props: EventProps = {}): void {
  if (typeof window === "undefined") return;
  if (!shouldTrack(window.navigator?.doNotTrack)) return;

  window.dataLayer?.push(buildPayload(event, props));
  window.plausible?.(event, { props });
  window.umami?.track(event, props);
}

/**
 * Delegated CTA tracking: any element with `data-cta="<id>"` reports a
 * `cta_clicked` event carrying that id, the page and the language. Captured at
 * the document level so it survives client-side navigation.
 */
export function initCtaTracking(): void {
  if (typeof document === "undefined") return;

  document.addEventListener(
    "click",
    (event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const el = target.closest<HTMLElement>("[data-cta]");
      if (!el?.dataset.cta) return;

      track("cta_clicked", {
        cta: el.dataset.cta,
        lang: document.documentElement.lang || "en",
        page: window.location.pathname,
      });
    },
    { capture: true },
  );
}
