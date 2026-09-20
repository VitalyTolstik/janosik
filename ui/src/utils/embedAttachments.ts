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
 * media sits on its own block — text, image, video, text keep their order
 * (the "structure" the paste must preserve). Images embed as images, video
 * and audio as player directives, everything else as a plain download link.
 */
export function embedMarkdown(file: File, attachmentId: string): string {
  const name = linkText(file.name);
  const url = attachmentContentUrl(attachmentId);
  let md: string;
  if (file.type.startsWith("image/")) {
    md = `![${name}](${url})`;
  } else if (file.type.startsWith("video/")) {
    md = `::video{src="${url}"}`;
  } else if (file.type.startsWith("audio/")) {
    md = `::audio{src="${url}"}`;
  } else {
    md = `[${name}](${url})`;
  }
  return `\n\n${md}\n\n`;
}

/**
 * MDXEditor `imagePreviewHandler`: an `<img>` fetch cannot carry the
 * Authorization header, so embedded attachment URLs are resolved to
 * authenticated blob object URLs (cached for the session); every other
 * source passes through untouched. The reverse map (object URL → attachment
 * id) backs the fullscreen viewer below.
 */
const previewCache = new Map<string, Promise<string>>();
const blobUrlOwners = new Map<string, string>();

export function attachmentImagePreviewHandler(src: string): Promise<string> {
  const id = attachmentIdFromUrl(src);
  if (!id) return Promise.resolve(src);
  let cached = previewCache.get(id);
  if (!cached) {
    cached = api
      .fetchAttachment(id)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        blobUrlOwners.set(url, id);
        return url;
      })
      .catch(() => src);
    previewCache.set(id, cached);
  }
  return cached;
}

/**
 * Fullscreen viewer for embedded images (Jira's lightbox): an imperative
 * overlay above every dialog — a single click anywhere, the ✕ button or
 * Escape closes it.
 */
export function openImageLightbox(src: string): void {
  if (document.getElementById("attachment-lightbox")) return;
  const overlay = document.createElement("div");
  overlay.id = "attachment-lightbox";
  overlay.setAttribute("data-testid", "attachment-lightbox");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Image preview");
  // Radix modal dialogs disable pointer events on <body> while open — the
  // overlay must opt back in, otherwise clicks fall through it into the
  // layers underneath (closing the card dialog instead of the viewer).
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.82);" +
    "display:flex;align-items:center;justify-content:center;padding:2rem;" +
    "cursor:zoom-out;pointer-events:auto";
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.style.cssText =
    "max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;" +
    "box-shadow:0 12px 48px rgba(0,0,0,0.55)";
  overlay.appendChild(img);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  };
  // Capture phase + stopPropagation: Escape and pointerdown must never
  // reach the Radix layers of the dialog underneath — they would dismiss
  // the card dialog instead of (or in addition to) the viewer.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };
  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  overlay.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });
  document.addEventListener("keydown", onKey, true);
  document.body.appendChild(overlay);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.setAttribute("data-testid", "attachment-lightbox-close");
  closeButton.setAttribute("aria-label", "Close");
  closeButton.textContent = "×";
  closeButton.style.cssText =
    "position:absolute;top:1rem;right:1.25rem;width:2.25rem;height:2.25rem;" +
    "border-radius:9999px;border:1px solid rgba(255,255,255,0.25);" +
    "background:rgba(255,255,255,0.12);color:#fff;font-size:1.4rem;line-height:1;" +
    "cursor:pointer;display:flex;align-items:center;justify-content:center;" +
    "padding:0";
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });
  overlay.appendChild(closeButton);
}

/** Resolve an embedded image's blob URL (cached when already previewed). */
function embeddedImageSrc(img: HTMLImageElement): string | Promise<string> {
  const src = img.getAttribute("src") ?? "";
  if (src.startsWith("blob:")) {
    return blobUrlOwners.has(src) ? src : "";
  }
  const id = attachmentIdFromUrl(src);
  if (!id) return "";
  // Not resolved yet (or resolution failed): fetch a fresh blob URL.
  return api
    .fetchAttachment(id)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      blobUrlOwners.set(url, id);
      return url;
    })
    .catch(() => src);
}

/**
 * Open the fullscreen viewer for one embedded attachment image. Shared by
 * the click delegation (read-only surfaces) and the double-click delegation
 * (edit mode, where a single click must keep the editor's image selection).
 */
export function handleAttachmentImageOpen(
  event: ReactMouseEvent | MouseEvent,
): void {
  const target = event.target as HTMLElement | null;
  const img = target?.closest?.("img");
  if (!img) return;
  const src = embeddedImageSrc(img);
  if (src === "") return;
  event.preventDefault();
  event.stopPropagation();
  void Promise.resolve(src)
    .then((url) => openImageLightbox(url))
    .catch(() => undefined);
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
