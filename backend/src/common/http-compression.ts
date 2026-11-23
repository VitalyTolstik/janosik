/**
 * TASK-200.6: content negotiation and compression for buffered JSON reads.
 *
 * Only the board aggregate route uses this helper. It deliberately does not
 * install global compression middleware: body parsers, uploads, error
 * envelopes, SSE and attachment streams must keep their existing bytes and
 * framing. The helper compresses one already-buffered response, so an SSE
 * stream (`text/event-stream`) or an already encoded/`no-transform` response
 * can never be buffered or re-encoded by accident.
 *
 * Brotli is preferred on a quality tie (q=1 for both), but quality values are
 * honoured strictly: `br;q=0, gzip` uses gzip and a client that only offers
 * identity gets the plain JSON. Compression runs on the libuv thread pool
 * (async `zlib`), so a multi-megabyte aggregate does not block the event loop.
 */
import { brotliCompress, constants, gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);
const brotliAsync = promisify(brotliCompress);

export type ContentEncoding = "identity" | "br" | "gzip";

/** Default threshold: tiny JSON messages are larger gzipped than plain. */
export const DEFAULT_COMPRESS_MIN_BYTES = 1024;

export interface CompressionOptions {
  /** Below this byte length the body stays identity. */
  minBytes?: number;
  gzipLevel?: number;
  brotliQuality?: number;
  /** Guard against compressing SSE/multipart/media or `no-transform`. */
  contentType?: string;
  cacheControl?: string;
}

export interface CompressedBody {
  body: Buffer;
  encoding: ContentEncoding;
  compressed: boolean;
}

/**
 * Parse `Accept-Encoding` into coding → q-value. Malformed q-values count as
 * zero; a missing header means identity-only. A wildcard is returned as `*`
 * so the negotiation order (br before gzip) still applies.
 */
export function parseAcceptEncoding(
  header: string | undefined,
): Map<string, number> {
  const parsed = new Map<string, number>();
  if (header === undefined) return parsed;
  for (const part of header.split(",")) {
    const token = part.trim();
    if (token === "") continue;
    const [rawCoding, ...params] = token.split(";");
    const coding = rawCoding.trim().toLowerCase();
    if (coding === "") continue;
    let quality = 1;
    for (const param of params) {
      const [rawKey, rawValue] = param.split("=");
      if (rawKey?.trim().toLowerCase() !== "q") continue;
      const value = Number(rawValue?.trim());
      quality = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    }
    // A repeated coding keeps the most permissive value.
    parsed.set(coding, Math.max(parsed.get(coding) ?? 0, quality));
  }
  return parsed;
}

/**
 * Pick the best supported coding. `br` wins a tie with `gzip`; an explicit
 * `q=0` for a coding excludes it, and `*` applies to the supported list when
 * a coding is not named. Identity is a representation too, and an unmentioned
 * identity counts as `q=1`: `gzip;q=0.5` therefore selects plain JSON, while
 * `gzip;q=1` or `*` selects compression. An explicit `identity;q` overrides
 * that default. When every coding and identity is refused, the board route
 * falls back to identity because it has no `406` contract — documented rather
 * than silently inventing an encoding.
 */
export function negotiateContentEncoding(
  header: string | undefined,
): ContentEncoding {
  if (header === undefined || header.trim() === "") return "identity";
  const accepted = parseAcceptEncoding(header);
  const wildcard = accepted.get("*");
  const quality = (coding: ContentEncoding): number => {
    const explicit = accepted.get(coding);
    if (explicit !== undefined) return explicit;
    return wildcard ?? 0;
  };
  const br = quality("br");
  const gzipQuality = quality("gzip");
  if (br <= 0 && gzipQuality <= 0) return "identity";
  const identity =
    accepted.get("identity") ?? (wildcard !== undefined ? wildcard : 1);
  const best = Math.max(br, gzipQuality);
  if (identity > best) return "identity";
  return br >= gzipQuality ? "br" : "gzip";
}

/**
 * Whether a response must stay uncompressed regardless of size. Streaming,
 * multipart and already encoded payloads are excluded, as is an explicit
 * `Cache-Control: no-transform`.
 */
export function isCompressionExcluded(
  contentType: string | undefined,
  cacheControl: string | undefined,
): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (
    type.startsWith("text/event-stream") ||
    type.startsWith("multipart/") ||
    type.startsWith("application/x-ndjson") ||
    type.startsWith("image/") ||
    type.startsWith("video/") ||
    type.startsWith("audio/")
  ) {
    return true;
  }
  return /(?:^|,)\s*no-transform\s*(?:,|$)/i.test(cacheControl ?? "");
}

/**
 * Compress a buffered body with the negotiated coding. Any failure falls back
 * to identity: compression is an optimisation and must never fail a read.
 */
export async function compressBody(
  body: Buffer,
  encoding: ContentEncoding,
  options: CompressionOptions = {},
): Promise<CompressedBody> {
  const minBytes = options.minBytes ?? DEFAULT_COMPRESS_MIN_BYTES;
  if (
    encoding === "identity" ||
    body.byteLength < minBytes ||
    isCompressionExcluded(options.contentType, options.cacheControl)
  ) {
    return { body, encoding: "identity", compressed: false };
  }
  try {
    const compressed =
      encoding === "br"
        ? await brotliAsync(body, {
            params: {
              [constants.BROTLI_PARAM_QUALITY]: options.brotliQuality ?? 4,
              [constants.BROTLI_PARAM_SIZE_HINT]: body.byteLength,
            },
          })
        : await gzipAsync(body, { level: options.gzipLevel ?? 6 });
    // A few highly random/short payloads grow when compressed; send identity
    // instead of a larger body with a Content-Encoding.
    if (compressed.byteLength >= body.byteLength) {
      return { body, encoding: "identity", compressed: false };
    }
    return { body: compressed, encoding, compressed: true };
  } catch {
    return { body, encoding: "identity", compressed: false };
  }
}
