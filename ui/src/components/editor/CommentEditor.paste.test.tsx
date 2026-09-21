import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Ref } from "react";

/**
 * Paste-embedding in the comment composer (TASK-48): the real composer
 * logic runs, only MDXEditor itself is stubbed (needs a layout engine);
 * the stub captures `insertMarkdown` — the imperative surface the paste
 * handler feeds embedded markdown into.
 */

const { inserts } = vi.hoisted(() => ({
  inserts: { markdown: [] as string[] },
}));

vi.mock("@mdxeditor/editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mdxeditor/editor")>();
  return import("react").then(({ forwardRef, useImperativeHandle }) => ({
    ...actual,
    MDXEditor: forwardRef(function MockedMdxEditor(
      {
        value,
        onChange,
      }: {
        value: string;
        onChange: (markdown: string) => void;
      },
      ref: Ref<{ insertMarkdown: (markdown: string) => void }>,
    ) {
      useImperativeHandle(ref, () => ({
        insertMarkdown: (markdown: string) => {
          inserts.markdown.push(markdown);
        },
      }));
      return (
        <textarea
          aria-label="Comment editor"
          defaultValue={value}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    }),
  }));
});

vi.mock("@/api/client", () => ({
  api: {
    uploadAttachment: vi.fn(),
    fetchAttachment: vi.fn(),
  },
  ApiError: class MockedApiError extends Error {
    constructor(
      public status: number,
      public body: unknown = null,
    ) {
      super(`ApiError ${status}`);
    }
  },
  isApiEnabled: () => true,
}));

import { api } from "@/api/client";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ToastProvider } from "@/components/Toast";
import { CommentComposerEditor } from "./CommentEditor";

function renderComposer() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <CommentComposerEditor
          cardId="card-1"
          value=""
          onChange={() => undefined}
          onSubmit={() => undefined}
        />
      </ToastProvider>
    </I18nProvider>,
  );
}

function attachment(id: string, fileName: string, mimeType: string) {
  return {
    id,
    cardId: "card-1",
    fileName,
    mimeType,
    sizeBytes: 4,
    uploadedById: "user-1",
    transcodeStatus: "none" as const,
    createdAt: 0,
  };
}

describe("CommentComposerEditor paste embedding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    inserts.markdown.length = 0;
  });

  it("uploads a pasted image inline and embeds it into the draft", async () => {
    vi.mocked(api.uploadAttachment).mockResolvedValue(
      attachment("att-inline", "pic.png", "image/png"),
    );
    renderComposer();
    const editor = screen.getByLabelText("Comment editor");

    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(["bits"], "pic.png", { type: "image/png" })],
      },
    });

    await waitFor(() => {
      expect(api.uploadAttachment).toHaveBeenCalledWith(
        "card-1",
        expect.any(File),
        { inline: true },
      );
    });
    await waitFor(() => {
      expect(inserts.markdown[0]).toBe(
        "\n\n![pic.png](/api/v1/attachments/att-inline/content)\n\n",
      );
    });
  });

  it("embeds a pasted non-image file as an inline download link", async () => {
    vi.mocked(api.uploadAttachment).mockResolvedValue(
      attachment("att-doc", "notes.pdf", "application/pdf"),
    );
    renderComposer();
    const editor = screen.getByLabelText("Comment editor");

    fireEvent.paste(editor, {
      clipboardData: {
        files: [new File(["bits"], "notes.pdf", { type: "application/pdf" })],
      },
    });

    await waitFor(() => {
      expect(api.uploadAttachment).toHaveBeenCalledWith(
        "card-1",
        expect.any(File),
        { inline: true },
      );
      expect(inserts.markdown[0]).toBe(
        "\n\n[notes.pdf](/api/v1/attachments/att-doc/content)\n\n",
      );
    });
  });
});
