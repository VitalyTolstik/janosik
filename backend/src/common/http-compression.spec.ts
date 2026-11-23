import { brotliDecompressSync, gunzipSync } from "node:zlib";
import {
  compressBody,
  isCompressionExcluded,
  negotiateContentEncoding,
  parseAcceptEncoding,
} from "./http-compression";

const BIG = Buffer.from("janosik board aggregate ".repeat(200));
const SMALL = Buffer.from('{"id":"tiny"}');

describe("parseAcceptEncoding", () => {
  it("parses codings and q-values", () => {
    const parsed = parseAcceptEncoding("gzip;q=0.8, br;q=1.0, identity;q=0");
    expect(parsed.get("gzip")).toBe(0.8);
    expect(parsed.get("br")).toBe(1);
    expect(parsed.get("identity")).toBe(0);
  });

  it("treats malformed q-values as zero and clamps the rest", () => {
    const parsed = parseAcceptEncoding("gzip;q=nope, br;q=7");
    expect(parsed.get("gzip")).toBe(0);
    expect(parsed.get("br")).toBe(1);
  });
});

describe("negotiateContentEncoding", () => {
  it("prefers Brotli on a quality tie", () => {
    expect(negotiateContentEncoding("gzip, deflate, br")).toBe("br");
    expect(negotiateContentEncoding("gzip;q=1, br;q=1")).toBe("br");
  });

  it("honours explicit quality values and q=0", () => {
    expect(negotiateContentEncoding("gzip;q=1, br;q=0.5")).toBe("gzip");
    expect(negotiateContentEncoding("br;q=0, gzip")).toBe("gzip");
    expect(negotiateContentEncoding("br;q=0, gzip;q=0")).toBe("identity");
  });

  it("applies a wildcard to supported codings", () => {
    expect(negotiateContentEncoding("*")).toBe("br");
    expect(negotiateContentEncoding("*;q=0.5, gzip;q=0.9")).toBe("gzip");
  });

  it("falls back to identity without a usable coding", () => {
    expect(negotiateContentEncoding(undefined)).toBe("identity");
    expect(negotiateContentEncoding("")).toBe("identity");
    expect(negotiateContentEncoding("identity")).toBe("identity");
    expect(negotiateContentEncoding("deflate")).toBe("identity");
  });
});

describe("isCompressionExcluded", () => {
  it("skips SSE, multipart, media and no-transform responses", () => {
    expect(isCompressionExcluded("text/event-stream", undefined)).toBe(true);
    expect(isCompressionExcluded("multipart/form-data", undefined)).toBe(true);
    expect(isCompressionExcluded("application/x-ndjson", undefined)).toBe(true);
    expect(isCompressionExcluded("video/mp4", undefined)).toBe(true);
    expect(
      isCompressionExcluded("application/json", "private, no-transform"),
    ).toBe(true);
    expect(isCompressionExcluded("application/json", "private, no-store")).toBe(
      false,
    );
  });
});

describe("compressBody", () => {
  it("gzips a large body and round-trips it", async () => {
    const result = await compressBody(BIG, "gzip");
    expect(result.compressed).toBe(true);
    expect(result.encoding).toBe("gzip");
    expect(result.body.byteLength).toBeLessThan(BIG.byteLength);
    expect(gunzipSync(result.body).equals(BIG)).toBe(true);
  });

  it("brotli-compresses a large body and round-trips it", async () => {
    const result = await compressBody(BIG, "br");
    expect(result.compressed).toBe(true);
    expect(result.encoding).toBe("br");
    expect(brotliDecompressSync(result.body).equals(BIG)).toBe(true);
  });

  it("keeps a tiny body as identity", async () => {
    const result = await compressBody(SMALL, "gzip", { minBytes: 1024 });
    expect(result).toEqual({
      body: SMALL,
      encoding: "identity",
      compressed: false,
    });
  });

  it("keeps identity when requested explicitly", async () => {
    const result = await compressBody(BIG, "identity");
    expect(result.encoding).toBe("identity");
    expect(result.body).toBe(BIG);
  });

  it("never compresses an SSE or no-transform response", async () => {
    const sse = await compressBody(BIG, "gzip", {
      contentType: "text/event-stream",
    });
    expect(sse).toEqual({
      body: BIG,
      encoding: "identity",
      compressed: false,
    });

    const noTransform = await compressBody(BIG, "br", {
      contentType: "application/json",
      cacheControl: "private, no-transform",
    });
    expect(noTransform.encoding).toBe("identity");
  });
});
