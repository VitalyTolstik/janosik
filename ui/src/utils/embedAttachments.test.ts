import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import {
  attachmentContentUrl,
  attachmentIdFromUrl,
  attachmentImagePreviewHandler,
  embedMarkdown,
  handleAttachmentImageOpen,
  openImageLightbox,
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

  it("embeds video and audio as player directives", () => {
    expect(
      embedMarkdown(new File(["x"], "clip.mp4", { type: "video/mp4" }), "v-1"),
    ).toBe('\n\n::video{src="/api/v1/attachments/v-1/content"}\n\n');
    expect(
      embedMarkdown(new File(["x"], "take.mp3", { type: "audio/mpeg" }), "a-1"),
    ).toBe('\n\n::audio{src="/api/v1/attachments/a-1/content"}\n\n');
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

  it("a failed fetch resolves to the calm unavailable-image placeholder", async () => {
    vi.mocked(api.fetchAttachment).mockRejectedValue(new Error("404"));

    const url = await attachmentImagePreviewHandler(
      "/api/v1/attachments/att-gone/content",
    );

    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    const svg = decodeURIComponent(url.replace("data:image/svg+xml,", ""));
    expect(svg).toContain("image unavailable");
    // No harsh fallback styling: the muted slate palette, no red, no ⚠️.
    expect(svg).toContain("#8b8fa3");
    expect(svg).not.toContain("red");
    expect(svg).not.toContain("⚠");
    vi.unstubAllGlobals();
  });
});

describe("fullscreen viewer (lightbox)", () => {
  function imageEvent(src: string) {
    const img = document.createElement("img");
    img.setAttribute("src", src);
    return {
      target: img,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    document.getElementById("attachment-lightbox")?.remove();
    vi.stubGlobal(
      "URL",
      Object.assign(URL, {
        createObjectURL: (blob: Blob) =>
          `blob:lb-${(blob as Blob).size}-${Math.random()}`,
      }),
    );
  });

  afterEach(() => {
    document.getElementById("attachment-lightbox")?.remove();
    vi.unstubAllGlobals();
  });

  it("opens for a previewed blob image and closes on click or Escape", async () => {
    vi.mocked(api.fetchAttachment).mockResolvedValue(
      new Blob(["x".repeat(7)], { type: "image/png" }),
    );
    const src = await attachmentImagePreviewHandler(
      "/api/v1/attachments/att-lb/content",
    );
    expect(src).toMatch(/^blob:lb-7-/);

    handleAttachmentImageOpen(imageEvent(src));
    await vi.waitFor(() => {
      expect(document.getElementById("attachment-lightbox")).not.toBeNull();
    });
    const overlay = document.getElementById("attachment-lightbox");
    expect(
      (overlay?.querySelector("img") as HTMLImageElement).getAttribute("src"),
    ).toBe(src);
    // Radix-proof: the overlay opts back into pointer events.
    expect(overlay?.style.pointerEvents).toBe("auto");

    overlay!.click();
    expect(document.getElementById("attachment-lightbox")).toBeNull();

    handleAttachmentImageOpen(imageEvent(src));
    await vi.waitFor(() => {
      expect(document.getElementById("attachment-lightbox")).not.toBeNull();
    });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.getElementById("attachment-lightbox")).toBeNull();
  });

  it("closes through the ✕ button", async () => {
    openImageLightbox("blob:close-btn");
    await vi.waitFor(() => {
      expect(document.getElementById("attachment-lightbox")).not.toBeNull();
    });
    const button = document.querySelector<HTMLButtonElement>(
      '[data-testid="attachment-lightbox-close"]',
    );
    expect(button).not.toBeNull();
    button!.click();
    expect(document.getElementById("attachment-lightbox")).toBeNull();
  });

  it("keeps pointerdown and Escape away from the layers underneath", async () => {
    openImageLightbox("blob:swallow");
    await vi.waitFor(() => {
      expect(document.getElementById("attachment-lightbox")).not.toBeNull();
    });
    const overlay = document.getElementById("attachment-lightbox")!;
    const seen: Event[] = [];
    const spy = (event: Event) => seen.push(event);
    document.addEventListener("pointerdown", spy);
    document.addEventListener("keydown", spy);
    overlay.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(seen).toHaveLength(0);
    document.removeEventListener("pointerdown", spy);
    document.removeEventListener("keydown", spy);
    expect(document.getElementById("attachment-lightbox")).toBeNull();
  });

  it("ignores non-images and unknown blob sources", () => {
    const div = document.createElement("div");
    const miss = {
      target: div,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;
    handleAttachmentImageOpen(miss);
    expect(miss.preventDefault).not.toHaveBeenCalled();
    expect(document.getElementById("attachment-lightbox")).toBeNull();

    handleAttachmentImageOpen(imageEvent("blob:never-seen"));
    expect(document.getElementById("attachment-lightbox")).toBeNull();
  });

  it("fetches a fresh blob for an image whose preview never resolved", async () => {
    vi.mocked(api.fetchAttachment).mockResolvedValue(
      new Blob(["y".repeat(9)], { type: "image/png" }),
    );
    handleAttachmentImageOpen(
      imageEvent("/api/v1/attachments/att-fresh/content"),
    );
    await vi.waitFor(() => {
      expect(document.getElementById("attachment-lightbox")).not.toBeNull();
    });
    expect(api.fetchAttachment).toHaveBeenCalledWith("att-fresh");
  });

  it("openImageLightbox is idempotent", () => {
    openImageLightbox("blob:one");
    openImageLightbox("blob:two");
    expect(
      document.querySelectorAll('[data-testid="attachment-lightbox"]'),
    ).toHaveLength(1);
  });
});
