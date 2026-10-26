import { env } from "@/config/env";

/**
 * The app's sub-path (TASK-123), normalised. The marketing site owns the site
 * root, so the app is served under a base (`/app`); standalone it is `""`.
 * The built UI uses the same base via Vite's `UI_BASE`.
 */

/** Without a trailing slash: `""` at the root, `"/app"` otherwise. */
export function appBasePath(): string {
  const trimmed = env.UI_BASE.trim().replace(/^\/+|\/+$/g, "");
  return trimmed === "" ? "" : `/${trimmed}`;
}

/** With a trailing slash: `"/"` at the root, `"/app/"` otherwise. */
export function appBasePrefix(): string {
  return `${appBasePath()}/`;
}
