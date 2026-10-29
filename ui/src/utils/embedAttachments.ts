import type { MouseEvent as ReactMouseEvent } from "react";

import { api } from "@/api/client";
import { defaultI18n } from "@/i18n/i18n";

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
 * Calm placeholder shown in place of an embedded image whose attachment can
 * no longer be loaded (deleted file, expired session, 404). MDXEditor's own
 * broken-image fallback is a harsh red-dashed box with a ⚠️ glyph — this
 * replaces it with a quiet dotted panel and a muted picture glyph that
 * reads as "intentionally empty" rather than "error".
 *
 * TASK-115: the tone comes from the theme's `--muted-foreground` token
 * (read once per call, with a slate fallback for environments that cannot
 * resolve CSS variables), so the placeholder follows the light/dark theme
 * and high-contrast modes instead of a hardcoded hex.
 */
function imageUnavailableTone(): string {
  if (typeof window === "undefined" || !window.getComputedStyle)
    return "#8b8fa3";
  const value = window
    .getComputedStyle(document.documentElement)
    .getPropertyValue("--muted-foreground")
    .trim();
  return value || "#8b8fa3";
}

function imageUnavailableUrl(): string {
  const tone = imageUnavailableTone();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="240" viewBox="0 0 420 240" role="img" aria-label="image unavailable"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${tone}" stop-opacity="0.14"/><stop offset="1" stop-color="${tone}" stop-opacity="0.05"/></linearGradient></defs><rect x="1" y="1" width="418" height="238" rx="14" fill="url(#bg)" stroke="${tone}" stroke-opacity="0.4" stroke-width="1.5" stroke-dasharray="1 7" stroke-linecap="round"/><g transform="translate(186 96)" fill="none" stroke="${tone}" stroke-opacity="0.6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="0" y="0" width="48" height="48" rx="10"/><circle cx="16" cy="16" r="4.2"/><path d="M44 34 L31 21 L9 43"/></g></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
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

/**
 * TASK-106: cap the preview cache so a long editing session cannot leak an
 * unbounded number of blob URLs. Evicting the oldest entry revokes its
 * object URL (freeing the blob) and drops the reverse-map entry — the
 * affected `<img>` simply re-fetches on its next render.
 */
const PREVIEW_CACHE_MAX = 100;

function evictPreviews(): void {
  while (previewCache.size > PREVIEW_CACHE_MAX) {
    const oldest = previewCache.keys().next();
    if (oldest.done) return;
    const id = oldest.value;
    const pending = previewCache.get(id);
    previewCache.delete(id);
    void pending
      ?.then((url) => {
        if (url.startsWith("blob:")) {
          URL.revokeObjectURL(url);
          blobUrlOwners.delete(url);
        }
      })
      .catch(() => undefined);
  }
}

/** Cache a resolved preview, marking it most-recently-used. */
function cachePreview(id: string, promise: Promise<string>): void {
  // Re-insert at the tail so the Map stays in least→most-recent order.
  previewCache.delete(id);
  previewCache.set(id, promise);
  evictPreviews();
}

export function attachmentImagePreviewHandler(src: string): Promise<string> {
  const id = attachmentIdFromUrl(src);
  if (!id) return Promise.resolve(src);
  const cached = previewCache.get(id);
  if (cached) {
    cachePreview(id, cached);
    return cached;
  }
  const pending = api
    .fetchAttachment(id)
    .then((blob) => {
      const url = URL.createObjectURL(blob);
      blobUrlOwners.set(url, id);
      return url;
    })
    // The raw src would keep failing as an <img> (no auth header) and
    // surface MDXEditor's red broken-image box — show the calm
    // placeholder instead.
    .catch(() => imageUnavailableUrl());
  cachePreview(id, pending);
  return pending;
}

/**
 * TASK-70: resolve a video's poster frame to an authenticated object URL.
 * Returns `null` (rather than a placeholder) when there is none, so the
 * player simply shows its default first frame.
 */
export async function attachmentPosterPreviewHandler(
  src: string,
): Promise<string | null> {
  const id = attachmentIdFromUrl(src);
  if (!id) return null;
  try {
    const blob = await api.fetchAttachmentDerivative(id, "poster");
    if (blob.size === 0) return null;
    const url = URL.createObjectURL(blob);
    blobUrlOwners.set(url, id);
    return url;
  } catch {
    return null;
  }
}

/**
 * Fullscreen viewer for embedded images (Jira's lightbox): an imperative
 * overlay above every dialog — a single click anywhere, the ✕ button or
 * Escape closes it. Focus is trapped on the close button and restored to the
 * opener; a blob URL minted only for the viewer is revoked on close
 * (TASK-152, C18).
 */
export function openImageLightbox(
  src: string,
  options: { revokeOnClose?: boolean; alt?: string } = {},
): void {
  const existing = document.getElementById("attachment-lightbox");
  if (existing !== null) {
    // Already open (TASK-156): a fresh URL minted for a second click is not
    // shown and must not leak; revoke it unless it is the displayed blob.
    const shown = existing.querySelector("img")?.getAttribute("src");
    if (
      options.revokeOnClose === true &&
      src.startsWith("blob:") &&
      shown !== src
    ) {
      URL.revokeObjectURL(src);
      blobUrlOwners.delete(src);
    }
    return;
  }
  const previouslyFocused =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  const overlay = document.createElement("div");
  overlay.id = "attachment-lightbox";
  overlay.setAttribute("data-testid", "attachment-lightbox");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute(
    "aria-label",
    defaultI18n.t("card.attachments.previewLabel"),
  );
  // Radix modal dialogs disable pointer events on <body> while open — the
  // overlay must opt back in, otherwise clicks fall through it into the
  // layers underneath (closing the card dialog instead of the viewer).
  // TASK-115: colors come from theme tokens (see index.css) so a
  // high-contrast theme can retune the scrim; the fallbacks keep the
  // viewer dark if the tokens are missing.
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;" +
    "background:var(--overlay, rgb(0 0 0 / 0.82));" +
    "display:flex;align-items:center;justify-content:center;padding:2rem;" +
    "cursor:zoom-out;pointer-events:auto";
  const img = document.createElement("img");
  img.src = src;
  img.alt = options.alt ?? defaultI18n.t("card.attachments.previewLabel");
  img.style.cssText =
    "max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;" +
    "box-shadow:var(--overlay-shadow, 0 12px 48px rgb(0 0 0 / 0.55))";
  overlay.appendChild(img);

  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    if (options.revokeOnClose === true && src.startsWith("blob:")) {
      URL.revokeObjectURL(src);
      blobUrlOwners.delete(src);
    }
    if (previouslyFocused?.isConnected === true) previouslyFocused.focus();
  };
  // Capture phase + stopPropagation: Escape, Tab and pointerdown must never
  // reach the Radix layers of the dialog underneath — they would dismiss
  // the card dialog instead of (or in addition to) the viewer. Tab is
  // pinned to the close button (the only focusable control) so focus cannot
  // escape the modal.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      closeButton.focus();
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
  closeButton.setAttribute(
    "aria-label",
    defaultI18n.t("card.attachments.previewClose"),
  );
  closeButton.textContent = "×";
  closeButton.style.cssText =
    "position:absolute;top:1rem;right:1.25rem;width:2.25rem;height:2.25rem;" +
    "border-radius:9999px;" +
    "border:1px solid var(--overlay-border, rgb(255 255 255 / 0.25));" +
    "background:var(--overlay-button, rgb(255 255 255 / 0.12));" +
    "color:var(--overlay-foreground, #fff);" +
    "font-size:1.4rem;line-height:1;" +
    "cursor:pointer;display:flex;align-items:center;justify-content:center;" +
    "padding:0";
  closeButton.addEventListener("click", (event) => {
    event.stopPropagation();
    close();
  });
  overlay.appendChild(closeButton);
  closeButton.focus();
}

/** Resolve an embedded image's blob URL (cached when already previewed). */
function embeddedImageSrc(img: HTMLImageElement): {
  src: string | Promise<string>;
  /** True when this call minted the URL (the viewer must revoke it). */
  owned: boolean;
} {
  const src = img.getAttribute("src") ?? "";
  if (src.startsWith("blob:")) {
    return { src: blobUrlOwners.has(src) ? src : "", owned: false };
  }
  const id = attachmentIdFromUrl(src);
  if (!id) return { src: "", owned: false };
  // Not resolved yet (or resolution failed): fetch a fresh blob URL. This
  // one belongs to the viewer alone, so closing it revokes the blob.
  return {
    src: api
      .fetchAttachment(id)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        blobUrlOwners.set(url, id);
        return url;
      })
      .catch(() => src),
    owned: true,
  };
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
  const resolved = embeddedImageSrc(img);
  if (resolved.src === "") return;
  event.preventDefault();
  event.stopPropagation();
  void Promise.resolve(resolved.src)
    .then((url) =>
      openImageLightbox(url, {
        revokeOnClose: resolved.owned,
        alt: img.alt || undefined,
      }),
    )
    .catch(() => undefined);
}

/**
 * Raster image types that are safe to open as a top-level document. A
 * `blob:` URL inherits the app's origin, so anything that can carry script
 * — SVG above all, or an unknown `image/*` subtype — must never be opened
 * as a page: it is downloaded instead, whatever the upload allowlist says.
 */
const SAFE_TOP_LEVEL_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

/**
 * Open or download one attachment blob: raster images render in a new tab,
 * other files (SVG included) are saved under their link text. Used by the
 * click delegation below.
 */
export async function openAttachmentBlob(
  attachmentId: string,
  fallbackName: string,
): Promise<void> {
  const blob = await api.fetchAttachment(attachmentId);
  const url = URL.createObjectURL(blob);
  const type = blob.type.split(";")[0]?.trim().toLowerCase() ?? "";
  if (SAFE_TOP_LEVEL_IMAGE_TYPES.has(type)) {
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
