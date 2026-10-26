import { appShareUrl } from "@/utils/app-path";

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
  const url = appShareUrl(
    `/#impersonate=${encodeURIComponent(result.accessToken)}`,
  );
  window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Downloads a data export as a file (TASK-71). A small account is built
 * inline (`ready` at once); a large one is queued, so this polls until the
 * artifact is ready (or gives up after ~60 s).
 */
export async function exportUser(userId: string): Promise<void> {
  const created = await adminApi.requestExport(userId);
  let status = created.status;
  let id = created.id;
  let filename = created.filename;
  for (let attempt = 0; status === "pending" && attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const rows = await adminApi.listExports();
    const row = rows.find((entry) => entry.id === id);
    if (row) {
      status = row.status;
      id = row.id;
      filename = row.filename;
    }
  }
  if (status !== "ready") {
    throw new Error("Export is not ready yet");
  }
  const blob = await adminApi.downloadExport(id);
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(href);
}
