/**
 * TASK-181.7: the admin attachment list filters by MIME family. Matching the
 * family in SQL with ILIKE prefixes and a negated "other" branch cannot use an
 * index and scans the whole table at 25k. Store the family once, index it, and
 * keep `mimeType` as the original uploaded value.
 *
 * The database trigger in the TASK-181.7 migration applies the same mapping to
 * rows written outside the upload service (fixtures, seeds, imports).
 */
export type AttachmentMimeFamily =
  "image" | "video" | "pdf" | "document" | "other";

const DOCUMENT_EQUALS = new Set([
  "application/rtf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
]);

export function attachmentMimeFamily(mimeType: string): AttachmentMimeFamily {
  const value = mimeType.toLowerCase();
  if (value.startsWith("image/")) return "image";
  if (value.startsWith("video/")) return "video";
  if (value === "application/pdf") return "pdf";
  if (
    value.startsWith("text/") ||
    DOCUMENT_EQUALS.has(value) ||
    value.startsWith("application/vnd.openxmlformats-officedocument.")
  ) {
    return "document";
  }
  return "other";
}
