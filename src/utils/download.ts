/**
 * Browser file download for text payloads (JSON export, quarantined data
 * dump, the pre-reset safety copy). Kept in one place because the details
 * are easy to get wrong: Firefox only follows a click on an anchor that is
 * in the document, and revoking the object URL synchronously can cancel the
 * download before it starts.
 */

const REVOKE_DELAY_MS = 1000;

export function downloadTextFile(
  filename: string,
  text: string,
  type = "application/json",
): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/** `janosik-boards-2026-09-14T10-30-00.json` — sortable, filename-safe. */
export function timestampedFilename(prefix: string, at = Date.now()): string {
  const stamp = new Date(at).toISOString().slice(0, 19).replace(/[:]/g, "-");
  return `${prefix}-${stamp}.json`;
}
