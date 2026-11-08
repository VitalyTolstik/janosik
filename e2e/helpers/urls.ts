/** App and site may be on separate origins in development. */
export const siteUrl = process.env.E2E_SITE_URL ?? "http://127.0.0.1:4300/";
export const appUrl = process.env.E2E_APP_URL ?? new URL("app/", siteUrl).href;
export const mailUrl = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:4802/";

/** Absolute URL of a page on the marketing site (deploy-base aware). */
export function sitePage(path = "/"): string {
  return new URL(path.replace(/^\/+/, ""), siteUrl).href;
}

/** Deploy-base-aware path of a site page, for raw `href` assertions. */
export function sitePath(path = "/"): string {
  return new URL(sitePage(path)).pathname;
}

/** Absolute app URL for an entry query such as `?lng=en&mode=register`. */
export function appEntry(query = ""): string {
  return new URL(query, appUrl).href;
}
