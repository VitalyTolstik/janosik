import type { Lang } from "./i18n/ui";

/**
 * Site-wide constants and navigation. The origin and base path come from the
 * Astro config (`site` / `base`), not from here.
 */
export const site = {
  name: "Janosik",
  tagline: "Kanban for your agent swarm.",
  description:
    "Janosik is a self-hosted Kanban board for a swarm of AI agents. Agents move cards, comment and tick checklists through the command API while you watch live. Open source (AGPL-3.0).",
  /** Where the app lives (Sign in / Create account link here). */
  appUrl: import.meta.env.PUBLIC_APP_URL ?? "https://app.janosik.app",
  githubUrl: "https://github.com/VitalyTolstik/janosik",
  license: "AGPL-3.0",
  /** Where the waitlist / contact CTAs write until billing lands (TASK-131). */
  contactEmail: import.meta.env.PUBLIC_CONTACT_EMAIL ?? "hello@janosik.app",
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

/**
 * A `mailto:` link for the waitlist / contact CTAs. Real checkout and a contact
 * form arrive with billing (TASK-131); until then these open a prefilled email
 * so a prospect can actually reach us. `subject` is the localised mail subject.
 */
export function contactLink(subject: string): string {
  return `mailto:${site.contactEmail}?subject=${encodeURIComponent(subject)}`;
}
