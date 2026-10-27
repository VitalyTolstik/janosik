import { APP_BASE } from "./app-path";

/**
 * Where the documentation lives, for the in-app Help menu (TASK-132). The
 * self-host image serves the marketing site and docs at the origin root and
 * the app under `/app/`, so the site root is derived by dropping the app's
 * `app/` segment; a split deployment (app and site on different hosts) sets
 * `VITE_SITE_URL` to the site origin, with a trailing slash.
 */
function siteBase(): string {
  const override = import.meta.env.VITE_SITE_URL;
  if (override) return override.endsWith("/") ? override : `${override}/`;
  return APP_BASE.endsWith("app/")
    ? APP_BASE.slice(0, -"app/".length)
    : APP_BASE;
}

/**
 * The docs URL for a language. Docs are localised under the site root:
 * English at `/docs/`, Russian at `/ru/docs/`.
 */
export function docsUrl(lang: string): string {
  return `${siteBase()}${lang === "ru" ? "ru/docs/" : "docs/"}`;
}
