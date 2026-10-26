import type { Lang } from "./i18n/ui";

/**
 * Site-wide constants and navigation. The origin and base path come from the
 * Astro config (`site` / `base`), not from here.
 */
export const site = {
  name: "Janosik",
  tagline: "Kanban that feels crafted.",
  description:
    "Janosik is a self-hosted, offline-first Kanban board — Trello-class drag & drop, calendar and table views, realtime sync and obsessive micro-detail. Run it yourself or use the hosted plan.",
  /** Where the app lives (Sign in / Create account link here). */
  appUrl: import.meta.env.PUBLIC_APP_URL ?? "https://app.janosik.app",
  githubUrl: "https://github.com/VitalyTolstik/janosik",
  license: "MIT",
} as const;

/** Primary navigation. `key` is an i18n key; `href` is a base-less path. */
export const nav = [
  { key: "nav.features", href: "/#features" },
  { key: "nav.pricing", href: "/pricing" },
  { key: "nav.docs", href: "/docs" },
] as const;

/**
 * App entry URL for a CTA. Preselects the visitor's language and, for the
 * sign-up CTA, the register form (`/app/?lng=ru&mode=register`), so the
 * handoff from the marketing site to the app feels continuous.
 */
export function appLink(lang: Lang, mode?: "register"): string {
  const params = new URLSearchParams({ lng: lang });
  if (mode === "register") params.set("mode", "register");
  const base = site.appUrl.replace(/\/+$/, "");
  return `${base}/?${params.toString()}`;
}
