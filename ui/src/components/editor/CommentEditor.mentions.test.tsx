import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
        data-testid="comment-send"
        onClick={() => setSubmitted(draft)}
      >
        Send
      </button>
      <output data-testid="composer-submitted">{submitted ?? ""}</output>
    </BoardLiveProvider>
  );
}

function setCaret(node: Node, offset: number) {
  const range = document.createRange();
  range.setStart(node, offset);
  range.collapse(true);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

describe("comment composer mentions (TASK-177.12)", () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
  });

  it.each([
    [
      "new paragraph",
      "<p>First</p><p><br></p>",
      (editor: HTMLElement) => editor.querySelectorAll("p")[1]!,
      1,
    ],
    [
      "list item",
      "<ul><li>One</li><li><br></li></ul>",
      (editor: HTMLElement) => editor.querySelectorAll("li")[1]!,
      1,
    ],
    [
      "line break",
      "<p>First<br><br></p>",
      (editor: HTMLElement) => editor.querySelector("p")!,
      3,
    ],
  ])("opens at a %s boundary", async (_label, html, pickNode, offset) => {
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
    editor.innerHTML = html;
    setCaret(pickNode(editor), offset);

    fireEvent.keyDown(editor, {
      key: "@",
      nativeEvent: { isComposing: false },
    });

    expect(await screen.findByTestId("mention-picker")).toBeVisible();
  });

  it("does not open inside inline code at the caret", () => {
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
    editor.innerHTML = "<p><code>alice</code></p>";
    const code = editor.querySelector("code")!.firstChild!;
    setCaret(code, 5);

    fireEvent.keyDown(editor, {
      key: "@",
      nativeEvent: { isComposing: false },
    });

    expect(screen.queryByTestId("mention-picker")).toBeNull();
  });

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

    fireEvent.click(screen.getByTestId("comment-send"));
    expect(screen.getByTestId("composer-submitted")).toHaveTextContent(
      "[@Alice Smith](https://janosik.invalid/mention/user-alice)",
    );
  });

  it("restores the literal @query on Escape and outside dismissal", async () => {
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
    fireEvent.keyDown(document, { key: "b" });
    fireEvent.keyDown(document, { key: "o" });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("mention-picker")).toBeNull();
    expect(screen.getByTestId("mock-comment-editor")).toHaveTextContent("@bo");
  });

  it("restores the literal @query on an outside click", async () => {
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
    fireEvent.keyDown(document, { key: "b" });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByTestId("mention-picker")).toBeNull();
    expect(screen.getByTestId("mock-comment-editor")).toHaveTextContent("@b");
  });

  it("discards a typed picker query when Send is pressed", async () => {
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
    fireEvent.keyDown(document, { key: "a" });
    fireEvent.keyDown(document, { key: "l" });

    const send = screen.getByTestId("comment-send");
    fireEvent.pointerDown(send);
    fireEvent.click(send);

    expect(screen.queryByTestId("mention-picker")).toBeNull();
    expect(screen.getByTestId("composer-submitted").textContent).toBe("");
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
    const text = editor.firstChild!;
    setCaret(text, "alice@".length);

    fireEvent.keyDown(editor, {
      key: "@",
      nativeEvent: { isComposing: false },
    });

    expect(screen.queryByTestId("mention-picker")).toBeNull();
    window.getSelection()?.removeAllRanges();
  });
});
