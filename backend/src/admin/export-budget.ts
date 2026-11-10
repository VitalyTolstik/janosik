import { PayloadTooLargeException } from "@nestjs/common";
import { MAX_EXPORT_BUNDLE_BYTES } from "@janosik/shared";

/**
 * TASK-166.6: the *combined* account bundle exceeded 50 MB. This is a hard
 * failure, unlike a single board that fails its own 25 MB preflight (that one
 * is skipped with a warning and the rest of the bundle still builds).
 */
export class BundleTooLargeException extends PayloadTooLargeException {
  constructor() {
    super({
      message: `Account export exceeds ${Math.round(
        MAX_EXPORT_BUNDLE_BYTES / (1024 * 1024),
      )} MB. Use pg_dump for a full-instance copy.`,
      code: "payload_too_large",
      limit: MAX_EXPORT_BUNDLE_BYTES,
    });
  }
}

/** Add one board to the running bundle budget; throws on overflow. */
export function addBoardToBundleBudget(
  currentBytes: number,
  boardBytes: number,
): number {
  const next = currentBytes + boardBytes;
  if (next > MAX_EXPORT_BUNDLE_BYTES) {
    throw new BundleTooLargeException();
  }
  return next;
}

/** Final size gate for the serialized bundle object. */
export function assertBundleBudget(bytes: number): void {
  if (bytes > MAX_EXPORT_BUNDLE_BYTES) throw new BundleTooLargeException();
}
