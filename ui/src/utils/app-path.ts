/**
 * The app's deploy base — Vite's `base`, e.g. `/app/` when the marketing site
 * owns the site root, or `/` standalone. Keeps its trailing slash.
 */
export const APP_BASE = import.meta.env.BASE_URL;

/**
 * Site-root-relative path for an in-app path:
 * `appPath("/board/1")` → `/app/board/1`. Use it wherever a path is written
 * as a raw string (an `<a href>`, `window.location.assign`, a copied link)
 * rather than through the router.
 */
export function appPath(path: string): string {
  return APP_BASE + path.replace(/^\/+/, "");
}

/** Absolute URL for sharing an in-app path (share links, card links). */
export function appShareUrl(path: string): string {
  return new URL(appPath(path), window.location.origin).href;
}
