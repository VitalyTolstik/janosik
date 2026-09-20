/**
 * Embedded media directives (TASK-48) on the real, unmocked MDXEditor
 * viewers: `::video{src="…"}` / `::audio{src="…"}` markdown renders native
 * players whose source is the authenticated blob object URL.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/api/client", () => ({
  api: {
    fetchAttachment: vi.fn(),
  },
}));

import { api } from "@/api/client";
import { CommentBody } from "./CommentEditor";
import { DescriptionEditor } from "./DescriptionEditor";

// jsdom doesn't implement Range.getBoundingClientRect/ClientRects — Lexical
// needs them when it commits DOM selection updates after edits.
if (typeof Range !== "undefined") {
  const zeroRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }) as DOMRect;
  Range.prototype.getBoundingClientRect ??= zeroRect;
  Range.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null }) as unknown as DOMRectList;
}

describe("media directives in markdown viewers", () => {
  it("renders a video directive as a native player", async () => {
    vi.mocked(api.fetchAttachment).mockResolvedValue(
      new Blob(["clip"], { type: "video/mp4" }),
    );
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:video-preview" }),
    );

    render(
      <CommentBody
        text={
          'before\n\n::video{src="/api/v1/attachments/vid-1/content"}\n\nafter'
        }
      />,
    );

    const video = await waitFor(() => {
      const el = document.querySelector("video.janosik-md-video");
      expect(el).not.toBeNull();
      return el;
    });
    expect(video!.getAttribute("src")).toBe("blob:video-preview");
    expect(video!.hasAttribute("controls")).toBe(true);
    // The surrounding text keeps its place.
    expect(screen.getByText("before")).toBeInTheDocument();
    expect(screen.getByText("after")).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it("renders an audio directive as a native player", async () => {
    vi.mocked(api.fetchAttachment).mockResolvedValue(
      new Blob(["take"], { type: "audio/mpeg" }),
    );
    vi.stubGlobal(
      "URL",
      Object.assign(URL, { createObjectURL: () => "blob:audio-preview" }),
    );

    render(
      <DescriptionEditor
        value={'::audio{src="/api/v1/attachments/aud-1/content"}'}
        onChange={() => undefined}
        readOnly
      />,
    );

    const audio = await waitFor(() => {
      const el = document.querySelector("audio.janosik-md-audio");
      expect(el).not.toBeNull();
      return el;
    });
    expect(audio!.getAttribute("src")).toBe("blob:audio-preview");
    vi.unstubAllGlobals();
  });
});
