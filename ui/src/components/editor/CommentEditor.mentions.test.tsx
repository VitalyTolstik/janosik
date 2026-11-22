import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BoardMemberDto } from "@janosik/shared";

/**
 * TASK-177.12 — the real composer trigger/insertion flow. MDXEditor itself is
 * stubbed, but the mention trigger, keyboard picker, imperative insertion and
 * submit path all run.
 */
vi.mock("@mdxeditor/editor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mdxeditor/editor")>();
  return import("react").then(({ forwardRef, useImperativeHandle }) => ({
    ...actual,
    MDXEditor: forwardRef(function MockedMdxEditor(
      {
        markdown,
        onChange,
      }: {
        markdown: string;
        onChange: (markdown: string) => void;
      },
      ref,
    ) {
      useImperativeHandle(ref, () => ({
        insertMarkdown: (next: string) => onChange(`${markdown}${next}`),
      }));
      return (
        <div
          data-testid="mock-comment-editor"
          contentEditable
          suppressContentEditableWarning
        >
          {markdown}
        </div>
      );
    }),
  }));
});

import { BoardLiveProvider, createBoardLive } from "@/store/board-live";
import { CommentComposerEditor } from "./CommentEditor";
import { I18nProvider } from "@/i18n/I18nProvider";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";

const MEMBER: BoardMemberDto = {
  userId: "user-alice",
  displayName: "Alice Smith",
  email: "alice@example.com",
  role: "MEMBER",
  expiresAt: null,
  avatarColor: null,
  avatarPath: null,
};

function Harness() {
  const [live] = useState(() => {
    const store = createBoardLive();
    store.members.set("board-1", [MEMBER]);
    return store;
  });
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  return (
    <BoardLiveProvider live={live}>
      <CommentComposerEditor
        cardId="card-1"
        boardId="board-1"
        value={draft}
        onChange={setDraft}
        onSubmit={() => setSubmitted(draft)}
      />
      <button
        type="button"
        data-testid="composer-send"
        onClick={() => setSubmitted(draft)}
      >
        Send
      </button>
      <output data-testid="composer-submitted">{submitted ?? ""}</output>
    </BoardLiveProvider>
  );
}

describe("comment composer mentions (TASK-177.12)", () => {
  it("opens on @, inserts the chosen member and submits the token", async () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <Harness />
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>,
    );

    fireEvent.keyDown(screen.getByTestId("comment-input"), {
      key: "@",
      nativeEvent: { isComposing: false },
    });

    expect(await screen.findByTestId("mention-picker")).toBeVisible();
    expect(document.querySelector('[aria-expanded="true"]')).not.toBeNull();
    expect(
      document.querySelector('[aria-controls$="-listbox"]'),
    ).not.toBeNull();

    fireEvent.keyDown(document, { key: "a" });
    await waitFor(() =>
      expect(
        document.querySelector('[aria-activedescendant$="-option-user-alice"]'),
      ).not.toBeNull(),
    );
    fireEvent.keyDown(document, { key: "Enter" });

    await waitFor(() =>
      expect(screen.getByTestId("mock-comment-editor")).toHaveTextContent(
        "[@Alice Smith](https://janosik.invalid/mention/user-alice)",
      ),
    );
    expect(document.querySelector('[aria-expanded="true"]')).toBeNull();

    fireEvent.click(screen.getByTestId("composer-send"));
    expect(screen.getByTestId("composer-submitted")).toHaveTextContent(
      "[@Alice Smith](https://janosik.invalid/mention/user-alice)",
    );
  });

  it("does not open inside an email address", () => {
    render(
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <Harness />
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>,
    );

    const editor = screen.getByTestId("mock-comment-editor");
    editor.textContent = "alice@";
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    fireEvent.keyDown(editor, {
      key: "@",
      nativeEvent: { isComposing: false },
    });

    expect(screen.queryByTestId("mention-picker")).toBeNull();
    window.getSelection()?.removeAllRanges();
  });
});
