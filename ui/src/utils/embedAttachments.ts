import type { MouseEvent as ReactMouseEvent } from "react";

import { api } from "@/api/client";

/**
 * Body-embedded attachments (Jira-style paste, TASK-48): files pasted into
 * the card description or a comment are uploaded as attachments and
 * referenced from the markdown body through their canonical `content` URL.
 * The URL is same-origin relative (`/api/v1` rides the Vite/nginx proxy),
 * so markdown bodies stay portable across origins.
 */

/** Canonical same-origin URL of an attachment blob. */
export function attachmentContentUrl(attachmentId: string): string {
  return `/api/v1/attachments/${attachmentId}/content`;
}

/**
 * Extract the attachment id from an embedded content URL. Deliberately
 * prefix-agnostic (works for `/api/v1/...` and custom `VITE_API_URL`s).
 */
export function attachmentIdFromUrl(
  url: string | null | undefined,
): string | null {
  if (!url) return null;
  const match = url.match(/\/attachments\/([A-Za-z0-9-]+)\/content/);
  return match ? (match[1] ?? null) : null;
}

/** Markdown-safe link/alt text: the few characters that break `[x](y)`. */
function linkText(name: string): string {
  const cleaned = name
    .replace(/[[\]()<>\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : "file";
}

/**
 * Markdown for one pasted file, wrapped in paragraph breaks so the pasted
 * media sits on its own block — text, image, text, file keep their order
 * (the "structure" the paste must preserve). Images embed as images,
 * everything else as a plain download link.
 */
export function embedMarkdown(file: File, attachmentId: string): string {
  const name = linkText(file.name);
  const url = attachmentContentUrl(attachmentId);
  const md = file.type.startsWith("image/")
    ? `![${name}](${url})`
    : `[${name}](${url})`;
  return `\n\n${md}\n\n`;
}

/**
 * MDXEditor `imagePreviewHandler`: an `<img>` fetch cannot carry the
 * Authorization header, so embedded attachment URLs are resolved to
 * authenticated blob object URLs (cached for the session); every other
 * source passes through untouched.
 */
const previewCache = new Map<string, Promise<string>>();

export function attachmentImagePreviewHandler(src: string): Promise<string> {
  const id = attachmentIdFromUrl(src);
  if (!id) return Promise.resolve(src);
  let cached = previewCache.get(id);
  if (!cached) {
    cached = api
      .fetchAttachment(id)
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => src);
    previewCache.set(id, cached);
  }
  return cached;
}

/**
 * Open or download one attachment blob: images render in a new tab, other
 * files are saved under their link text. Used by the click delegation below.
 */
export async function openAttachmentBlob(
  attachmentId: string,
  fallbackName: string,
): Promise<void> {
  const blob = await api.fetchAttachment(attachmentId);
  const url = URL.createObjectURL(blob);
  if (blob.type.startsWith("image/")) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fallbackName || "file";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Capture-phase click delegation for embedded attachment links: the anchor
 * navigation cannot carry the Authorization header, so the click is
 * rerouted through the API client. Attachment links stop here (no Lexical
 * link toolbar, no 401 navigation); ordinary links are left untouched.
 */
export function handleAttachmentLinkClick(
  event: ReactMouseEvent | MouseEvent,
): void {
  const target = event.target as HTMLElement | null;
  const anchor = target?.closest?.("a");
  if (!anchor) return;
  const id = attachmentIdFromUrl(anchor.getAttribute("href"));
  if (!id) return;
  event.preventDefault();
  event.stopPropagation();
  void openAttachmentBlob(id, anchor.textContent ?? "").catch(() => undefined);
}
