import { randomUUID } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { env } from "@/config/env";

/**
 * Accepted attachment MIME types (TASK-47, tightened in TASK-76). A
 * deliberate allowlist of everything a task tracker plausibly carries —
 * images, media, documents, archives. Scriptable/HTML types are excluded:
 * `text/*` is narrowed to `text/plain` and `application/octet-stream` is
 * dropped entirely, so a stored-XSS payload cannot masquerade as an
 * "allowed" generic type. The upload additionally verifies the bytes
 * (`sniffMime`), and the stream routes serve with a hard
 * `Content-Disposition: attachment`.
 */
export const ATTACHMENT_MIME_ALLOWLIST =
  /^(image\/(png|jpeg|gif|webp|bmp|avif|heic)|text\/plain|video\/[\w.+-]+|audio\/[\w.+-]+|application\/(pdf|json|rtf|zip|x-zip-compressed|x-7z-compressed|gzip|x-tar|msword|vnd\.ms-excel|vnd\.ms-powerpoint|vnd\.openxmlformats-officedocument\.[\w-]+\.[\w-]+))$/;

/** Avatar images only (TASK-47) — renderable by <img> without scripts. */
export const AVATAR_MIME_ALLOWLIST = /^image\/(png|jpeg|gif|webp)$/;

/** Types that must carry a magic-byte signature (TASK-76): a client that
 *  declares one of these but uploads unrecognizable bytes is lying. */
export const SIGNATURE_REQUIRED_MIME =
  /^(image\/|video\/|audio\/|application\/(pdf|rtf|zip|x-zip-compressed|gzip|x-7z-compressed|vnd\.openxmlformats-officedocument\.))/;

/**
 * Identify a blob by its magic bytes (TASK-76) — the server-authoritative
 * type, never the client's multipart `Content-Type`. Returns a canonical
 * MIME for the families the allowlist accepts, or `null` when the bytes
 * carry no known signature (plain text, JSON, …). Deliberately small and
 * dependency-free; unknown signatures stay `null` rather than guessing.
 */
export function sniffMime(buffer: Buffer): string | null {
  const ascii = (start: number, end: number): string =>
    buffer.toString("latin1", start, end);
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (buffer.length >= 6) {
    const head = ascii(0, 6);
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (buffer.length >= 12 && ascii(0, 4) === "RIFF") {
    const kind = ascii(8, 12);
    if (kind === "WEBP") return "image/webp";
    if (kind === "WAVE") return "audio/wav";
  }
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) {
    return "image/bmp";
  }
  if (buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b) {
    return "application/gzip";
  }
  if (buffer.length >= 4) {
    const head = ascii(0, 4);
    if (head === "PK\u0003\u0004") return "application/zip";
    if (head === "%PDF") return "application/pdf";
    if (head === "{\\rt") return "application/rtf";
    if (head === "OggS") return "audio/ogg";
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x1a &&
    buffer[1] === 0x45 &&
    buffer[2] === 0xdf &&
    buffer[3] === 0xa3
  ) {
    return "video/webm";
  }
  if (buffer.length >= 6 && buffer.subarray(0, 6).equals(SEVEN_ZIP_SIGNATURE)) {
    return "application/x-7z-compressed";
  }
  // ISO base media (MP4/MOV/AVIF/HEIC): a box size then `ftyp` + brand.
  if (buffer.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "qt  ") return "video/quicktime";
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
    if (["isom", "iso2", "mp41", "mp42", "avc1", "dash"].includes(brand)) {
      return "video/mp4";
    }
    if (brand === "M4A ") return "audio/mp4";
  }
  if (buffer.length >= 3 && ascii(0, 3) === "ID3") return "audio/mpeg";
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return "audio/mpeg";
  }
  return null;
}

/** Canonical extension for a server-detected type (TASK-76/120) — used to
 *  name avatar blobs so the served `Content-Type` matches the real bytes. */
const MIME_EXTENSION: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/avif": ".avif",
  "image/heic": ".heic",
};

export function extensionForMime(mime: string): string | null {
  return MIME_EXTENSION[mime] ?? null;
}

/** Inverse of `MIME_EXTENSION` (TASK-120): the served `Content-Type` for a
 *  server-named avatar blob, derived from its extension — never from the
 *  client's original file name. */
export function mimeForExtension(ext: string): string {
  const dot = ext.startsWith(".") ? ext : `.${ext}`;
  const match = Object.entries(MIME_EXTENSION).find(([, e]) => e === dot);
  return match?.[0] ?? "application/octet-stream";
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const SEVEN_ZIP_SIGNATURE = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

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
  private readonly root: string;
  private readonly avatarRoot: string;

  /** `root` is overridable for tests; production reads the validated
   *  `UPLOAD_DIR`. A relative value is anchored to the backend package dir,
   *  not the process cwd (see above). */
  constructor(@Optional() root?: string) {
    const base = path.join(__dirname, "..", "..");
    const configured = (root ?? env.UPLOAD_DIR).trim();
    this.root =
      configured.length > 0
        ? path.resolve(base, configured)
        : path.join(base, "data", "uploads");
    this.avatarRoot = path.join(this.root, "avatars");
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

  /**
   * Stream a blob to an HTTP response (TASK-78). `open` already 404s when the
   * file is gone; `pipeline` owns the error handling from then on, so a blob
   * that disappears mid-read (the orphan sweep, a concurrent delete) aborts
   * the response instead of emitting an unhandled `'error'` on the read
   * stream and taking the process down. A failure after the response is
   * already torn down is a client abort — nothing left to answer, so it is
   * swallowed rather than surfaced as a server error.
   */
  async send(absPath: string, res: Writable): Promise<void> {
    try {
      await pipeline(this.open(absPath), res);
    } catch (err) {
      if (!res.destroyed) throw err;
    }
  }

  /** Delete a blob best-effort — a missing file is not an error here. */
  async remove(absPath: string): Promise<void> {
    await unlink(absPath).catch(() => undefined);
  }

  /**
   * Every stored blob (TASK-68 orphan sweep): files in the root plus avatars
   * in their subfolder, each with its `mtimeMs` so the sweep can spare
   * freshly written blobs (TASK-77 — a row may not be committed yet).
   * Best-effort: a missing tree yields none and a file that vanishes
   * mid-scan is skipped.
   */
  async listBlobs(): Promise<
    Array<{ name: string; avatar: boolean; absPath: string; mtimeMs: number }>
  > {
    const out: Array<{
      name: string;
      avatar: boolean;
      absPath: string;
      mtimeMs: number;
    }> = [];
    const scan = async (dir: string, avatar: boolean): Promise<void> => {
      let entries: import("node:fs").Dirent[] = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!entry.isFile() || entry.name.startsWith(".tmp-")) continue;
        const absPath = path.join(dir, entry.name);
        let mtimeMs: number;
        try {
          mtimeMs = (await stat(absPath)).mtimeMs;
        } catch {
          continue;
        }
        out.push({ name: entry.name, avatar, absPath, mtimeMs });
      }
    };
    await scan(this.root, false);
    await scan(this.avatarRoot, true);
    return out;
  }
}
