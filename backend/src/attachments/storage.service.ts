import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";

import { Injectable, Logger, NotFoundException } from "@nestjs/common";

/**
 * Accepted attachment MIME types (TASK-47). A deliberate allowlist of
 * everything a task tracker plausibly carries — images, media, documents,
 * archives. Executable-ish types (html, svg, x-sh) are excluded even inside
 * the wildcard families: the stream route serves with a hard
 * `Content-Disposition: attachment`, but never handing out scriptable types
 * keeps the allowlist honest.
 */
export const ATTACHMENT_MIME_ALLOWLIST =
  /^(image\/(png|jpeg|gif|webp|bmp|avif|heic)|text\/[\w.+-]+|video\/[\w.+-]+|audio\/[\w.+-]+|application\/(pdf|json|rtf|zip|x-zip-compressed|x-7z-compressed|gzip|x-tar|octet-stream|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[\w-]+\.[\w-]+))$/;

/** Avatar images only (TASK-47) — renderable by <img> without scripts. */
export const AVATAR_MIME_ALLOWLIST = /^image\/(png|jpeg|gif|webp)$/;

/**
 * Self-hosted blob storage (TASK-47): files live under `UPLOAD_DIR`
 * (default `backend/data/uploads`), avatars under its `avatars/` subfolder.
 * The default is anchored to the backend package, never to the process
 * working directory — a server launched from anywhere must resolve the
 * same blobs (the cwd-relative default once "lost" every upload after a
 * restart from another folder).
 * Every stored name is server-generated (`cuid`-like UUID + sanitized
 * extension) — client file names are metadata and never touch the disk.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  /** Anchored to the backend package dir, not the process cwd (see above). */
  private readonly root = path.resolve(
    process.env.UPLOAD_DIR ??
      path.join(__dirname, "..", "..", "data", "uploads"),
  );
  private readonly avatarRoot = path.join(this.root, "avatars");

  constructor() {
    this.logger.log(`Blob storage root: ${this.root}`);
  }

  /** Create the storage tree lazily (first upload after a fresh clone). */
  async ensureDirs(): Promise<void> {
    await mkdir(this.avatarRoot, { recursive: true });
  }

  /**
   * Client-provided file name for display: strip any directory component
   * and control characters, cap the length. Empty after cleaning → a
   * neutral fallback (the attachment keeps a usable label).
   */
  sanitizeFileName(original: string): string {
    // Busboy (multer) decodes multipart filenames as latin1, so every
    // non-ASCII name arrives mojibake ("Screenshot â€¯AM.png"). The bytes
    // are the original UTF-8 — re-decode them; pure-ASCII names are
    // unaffected by the round-trip.
    const decoded = Buffer.from(original ?? "", "latin1").toString("utf8");
    const base = path
      .basename(decoded)
      // eslint-disable-next-line no-control-regex -- stripping C0/C1 controls is the point
      .replace(/[\u0000-\u001f\u007f]/g, "");
    const trimmed = base.trim().slice(0, 200);
    return trimmed.length > 0 ? trimmed : "file";
  }

  /**
   * Server-side blob name: random UUID + a conservative extension taken
   * from the original name (alnum only, ≤10 chars) — nothing else survives.
   */
  storedName(original: string): string {
    const ext = path.extname(original ?? "");
    const safe = /^(\.[a-z0-9]{1,10})$/i.test(ext) ? ext.toLowerCase() : "";
    return `${randomUUID()}${safe}`;
  }

  /** Absolute path of an attachment blob; rejects anything path-like. */
  attachmentPath(storedName: string): string {
    const resolved = path.resolve(this.root, storedName);
    if (
      !resolved.startsWith(this.root + path.sep) ||
      storedName.includes("/") ||
      storedName.includes("\\")
    ) {
      throw new NotFoundException();
    }
    return resolved;
  }

  avatarPath(storedName: string): string {
    const resolved = path.resolve(this.avatarRoot, storedName);
    if (
      !resolved.startsWith(this.avatarRoot + path.sep) ||
      storedName.includes("/") ||
      storedName.includes("\\")
    ) {
      throw new NotFoundException();
    }
    return resolved;
  }

  /** File stream for a stored blob (404s when the file went missing). */
  open(absPath: string): NodeJS.ReadableStream {
    if (!existsSync(absPath)) throw new NotFoundException();
    return createReadStream(absPath);
  }

  /** Delete a blob best-effort — a missing file is not an error here. */
  async remove(absPath: string): Promise<void> {
    await unlink(absPath).catch(() => undefined);
  }
}
