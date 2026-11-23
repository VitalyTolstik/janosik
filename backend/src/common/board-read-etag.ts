/**
 * TASK-200.6: weak validators for the full board read.
 *
 * ETag material is `seq + route + role + projection` plus the board row's
 * `updatedAt`, which covers the few board metadata writes that do not advance
 * the command seq (`agentPolicy`/pause updates, admin restore). Board id is
 * included so two boards can never share a validator. The material is hashed
 * into an opaque tag: board ids and roles are not written to the header, and
 * no token, user id, email or share token can ever become a cache key.
 *
 * The validator is weak (`W/...`) because gzip and Brotli are different byte
 * representations of the same JSON. Weak comparison is exactly what
 * `If-None-Match` needs for a GET/HEAD 304.
 */
import { createHash } from "node:crypto";

/** Bump when the aggregate's shape changes without a seq/updatedAt change. */
export const BOARD_READ_ETAG_VERSION = "v1";

export interface BoardReadValidatorInput {
  boardId: string;
  seq: number;
  /** `Board.updatedAt` of the snapshot the body was built from. */
  updatedAt: number;
  /** Logical route; one ETag namespace per route. */
  route: string;
  /** Board role (projection scope); a future role-shaped read must not reuse. */
  role: string;
  /** Projection name + version, e.g. `board-full:v1`. */
  projection: string;
}

/** Build a stable opaque weak ETag for one board read representation. */
export function boardReadEtag(input: BoardReadValidatorInput): string {
  const material = [
    BOARD_READ_ETAG_VERSION,
    input.route,
    input.boardId,
    String(input.seq),
    String(input.updatedAt),
    input.role,
    input.projection,
  ].join("\n");
  const digest = createHash("sha256")
    .update(material, "utf8")
    .digest("base64url")
    .slice(0, 32);
  return `W/"${digest}"`;
}

/**
 * Weak `If-None-Match` comparison (RFC 9110 §13.1.2): `*` matches any current
 * representation; otherwise weak prefixes are ignored and the quoted opaque
 * tags are compared. A malformed header never produces a false 304.
 */
export function ifNoneMatchMatches(
  header: string | undefined,
  etag: string,
): boolean {
  if (header === undefined) return false;
  const current = opaqueTag(etag);
  if (current === undefined) return false;
  for (const candidate of header.split(",")) {
    const trimmed = candidate.trim();
    if (trimmed === "*") return true;
    if (opaqueTag(trimmed) === current) return true;
  }
  return false;
}

function opaqueTag(value: string): string | undefined {
  let candidate = value.trim();
  if (/^W\//i.test(candidate)) candidate = candidate.slice(2).trim();
  // ETag grammar requires quotes; accepting a bare token would let a client
  // turn an unrelated header value into an accidental match.
  if (candidate.length < 2) return undefined;
  if (!candidate.startsWith('"') || !candidate.endsWith('"')) return undefined;
  return candidate;
}
