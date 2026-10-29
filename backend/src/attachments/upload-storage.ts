import { randomUUID } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";

import { diskStorage } from "multer";
import { env } from "@/config/env";

/**
 * Upload plumbing (TASK-155): multer writes the multipart body straight to a
 * `.tmp-*` file in the blob root instead of buffering up to 25 MB per request
 * in memory. The service validates the file, then `rename`s it into place
 * (same filesystem, atomic); the temp sweep (TASK-148) collects anything a
 * crash leaves behind.
 */

/**
 * The blob root, resolved exactly like `StorageService` does it: a relative
 * `UPLOAD_DIR` is anchored to the backend package, not the process cwd.
 */
export function uploadRoot(): string {
  const base = path.join(__dirname, "..", "..");
  const configured = env.UPLOAD_DIR.trim();
  return configured.length > 0
    ? path.resolve(base, configured)
    : path.join(base, "data", "uploads");
}

/** multer engine: stream into `<upload root>/.tmp-<uuid><ext>`. */
export const tempUploadStorage = diskStorage({
  destination: (_req, _file, cb) => {
    const dir = uploadRoot();
    mkdir(dir, { recursive: true })
      .then(() => cb(null, dir))
      .catch((error: unknown) => cb(error as Error, dir));
  },
  filename: (_req, file, cb) => {
    // Only a short, safe extension survives from the client name; the rest of
    // the temp name is ours (a client-supplied name must never be a path).
    const ext = path
      .extname(file.originalname)
      .slice(0, 16)
      .replace(/[^.A-Za-z0-9]/g, "");
    cb(null, `.tmp-${randomUUID()}${ext}`);
  },
});

/** Read at most `bytes` from the start of a file (magic-byte sniffing). */
export async function readFilePrefix(
  filePath: string,
  bytes = 4096,
): Promise<Buffer> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
