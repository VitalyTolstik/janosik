import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { downloadTextFile, timestampedFilename } from "@/utils/download";

/**
 * `download.ts` holds the browser-download details that are easy to break:
 * the filename must stay sortable/filename-safe, and the object URL must be
 * revoked only after the click has started the download (Firefox cancels a
 * synchronous revoke).
 */

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe("timestampedFilename", () => {
  it("stamps a fixed date as a filename-safe ISO string", () => {
    const at = Date.UTC(2026, 8, 14, 10, 30, 0);
    expect(timestampedFilename("janosik-boards", at)).toBe(
      "janosik-boards-2026-09-14T10-30-00.json",
    );
  });

  it("uses the current time by default", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-14T10:30:00.000Z"));
    expect(timestampedFilename("dump")).toBe("dump-2026-09-14T10-30-00.json");
    vi.useRealTimers();
  });
});

describe("downloadTextFile", () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    createObjectURL = vi.fn(() => "blob:mock-url");
    revokeObjectURL = vi.fn();
    URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
    URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL;
    // jsdom cannot navigate to a blob: URL — stub the click on every anchor.
    vi.spyOn(HTMLElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("appends an anchor, clicks it, removes it, then revokes later", () => {
    vi.useFakeTimers();
    const appendChild = vi.spyOn(document.body, "appendChild");

    downloadTextFile("export.json", "payload");

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(appendChild).toHaveBeenCalledTimes(1);
    const anchor = appendChild.mock.calls[0]?.[0] as HTMLAnchorElement;
    expect(anchor.tagName).toBe("A");
    expect(anchor.getAttribute("href")).toBe("blob:mock-url");
    expect(anchor.download).toBe("export.json");
    expect(anchor.rel).toBe("noopener");
    expect(HTMLElement.prototype.click).toHaveBeenCalledTimes(1);
    // Anchors are removed from the DOM right after the click.
    expect(document.body.contains(anchor)).toBe(false);

    // The revoke is deferred: killing the URL synchronously cancels the
    // download before the browser has read the blob.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-url");
  });

  it("defaults the blob MIME type to JSON and honors an override", () => {
    vi.useFakeTimers();
    downloadTextFile("export.json", "{}");
    const defaultBlob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(defaultBlob.type).toBe("application/json");

    createObjectURL.mockClear();
    downloadTextFile("dump.txt", "raw", "text/plain");
    const textBlob = createObjectURL.mock.calls[0]?.[0] as Blob;
    expect(textBlob.type).toBe("text/plain");
    vi.advanceTimersByTime(1000);
  });
});
