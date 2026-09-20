import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  attachmentContentUrl,
  attachmentIdFromUrl,
  attachmentImagePreviewHandler,
  embedMarkdown,
} from "./embedAttachments";

vi.mock("@/api/client", () => ({
  api: {
    fetchAttachment: vi.fn(),
  },
}));

import { api } from "@/api/client";

describe("attachmentIdFromUrl", () => {
  it("extracts ids from embedded content URLs (any origin prefix)", () => {
    expect(attachmentIdFromUrl("/api/v1/attachments/abc-123/content")).toBe(
      "abc-123",
    );
    expect(
      attachmentIdFromUrl(
        "https://x.example.com/api/v1/attachments/id1/content",
      ),
    ).toBe("id1");
  });

  it("returns null for ordinary links and empties", () => {
    expect(attachmentIdFromUrl("https://example.com/page")).toBeNull();
    expect(
      attachmentIdFromUrl("/api/v1/admin/attachments/x/download"),
    ).toBeNull();
    expect(attachmentIdFromUrl(null)).toBeNull();
    expect(attachmentIdFromUrl(undefined)).toBeNull();
  });
});

describe("attachmentContentUrl", () => {
  it("builds the canonical same-origin URL", () => {
    expect(attachmentContentUrl("a1")).toBe("/api/v1/attachments/a1/content");
  });
});

describe("embedMarkdown", () => {
  it("embeds images as block images", () => {
    const md = embedMarkdown(
      new File(["x"], "shot.png", { type: "image/png" }),
      "att-1",
    );
    expect(md).toBe("\n\n![shot.png](/api/v1/attachments/att-1/content)\n\n");
  });

  it("embeds other files as download links", () => {
    const md = embedMarkdown(
      new File(["x"], "spec.pdf", { type: "application/pdf" }),
      "att-2",
    );
    expect(md).toBe("\n\n[spec.pdf](/api/v1/attachments/att-2/content)\n\n");
  });

  it("strips characters that would break the markdown link", () => {
    const md = embedMarkdown(
      new File(["x"], "we[ird] (name).png", { type: "image/png" }),
      "att-3",
    );
    expect(md).toBe(
      "\n\n![we ird name .png](/api/v1/attachments/att-3/content)\n\n",
    );
  });

  it("falls back to a placeholder name for an empty one", () => {
    const md = embedMarkdown(new File(["x"], "", { type: "image/png" }), "a");
    expect(md).toContain("![file](/api/v1/attachments/a/content)");
  });
});

describe("attachmentImagePreviewHandler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves attachment URLs to authenticated blob object URLs", async () => {
    vi.mocked(api.fetchAttachment).mockResolvedValue(
      new Blob(["bits"], { type: "image/png" }),
    );
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:preview-1" }),
    );
    await expect(
      attachmentImagePreviewHandler("/api/v1/attachments/att-9/content"),
    ).resolves.toBe("blob:preview-1");
    expect(api.fetchAttachment).toHaveBeenCalledWith("att-9");
    vi.unstubAllGlobals();
  });

  it("passes ordinary sources through and caches attachment fetches", async () => {
    vi.mocked(api.fetchAttachment).mockResolvedValue(
      new Blob(["bits"], { type: "image/png" }),
    );
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:preview-2" }),
    );
    await expect(
      attachmentImagePreviewHandler("https://cdn.example.com/x.png"),
    ).resolves.toBe("https://cdn.example.com/x.png");
    expect(api.fetchAttachment).not.toHaveBeenCalled();

    await attachmentImagePreviewHandler(
      "/api/v1/attachments/att-cache/content",
    );
    await attachmentImagePreviewHandler(
      "/api/v1/attachments/att-cache/content",
    );
    expect(api.fetchAttachment).toHaveBeenCalledTimes(1);
    expect(api.fetchAttachment).toHaveBeenCalledWith("att-cache");
    vi.unstubAllGlobals();
  });
});
