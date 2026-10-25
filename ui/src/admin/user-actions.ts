import { adminApi } from "./admin-client";

/**
 * TASK-59 support helpers shared by the user detail page and the users list:
 * minting a "view as" session and downloading a data export.
 */

/**
 * Mints a short impersonation token and opens the app with it in a new tab.
 * The app consumes the `#impersonate=` hash, adopts the token and shows an
 * irremovable banner naming the master (see `ui/src/api/client.ts`).
 */
export async function impersonateUser(userId: string): Promise<void> {
  const result = await adminApi.impersonateUser(userId);
  const url = `${window.location.origin}/#impersonate=${encodeURIComponent(
    result.accessToken,
  )}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Downloads the JSON export bundle as a file. */
export async function exportUser(userId: string): Promise<void> {
  const result = await adminApi.exportUser(userId);
  const blob = new Blob([JSON.stringify(result.data, null, 2)], {
    type: "application/json",
  });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = result.filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
