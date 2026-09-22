import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommentDto } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { CardActivity } from "@/components/board/CardActivity";
import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

// Same trade as CardComments.test: the thread behaviour under test is the
// data flow, not the MDXEditor internals.
vi.mock("@/components/editor/CommentEditor", () => ({
  CommentComposerEditor: ({
    onChange,
    onSubmit,
    placeholder,
  }: {
    onChange: (value: string) => void;
    onSubmit: () => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="comment-input"
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
          onSubmit();
        }
      }}
    />
  ),
  CommentBody: ({ text }: { text: string }) => <p>{text}</p>,
}));

/**
 * The Activity section (TASK-37): both tab counts render as soon as the
 * dialog opens — the hidden view stays mounted and keeps loading, so no
 * click is needed to see the History badge.
 */

const AT = 1_760_000_000_000;

function comment(id: string): CommentDto {
  return {
    id,
    cardId: "card-1",
    authorId: "user-1",
    text: `Note ${id}`,
    createdAt: AT,
  };
}

function renderActivity() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/board/b-1"]}>
            <TooltipProvider>
              <BoardProvider>
                <UserProfileProvider boardId="b-1">
                  <CardActivity cardId="card-1" boardId="b-1" updatedAt={AT} />
                </UserProfileProvider>
              </BoardProvider>
            </TooltipProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("CardActivity", () => {
  it("shows both tab counts without clicking any tab", async () => {
    const server = new FakeServer();
    server.seedComments("card-1", [comment("c-1"), comment("c-2")]);
    server.seedActivity("card-1", [
      {
        source: "command",
        id: "cmd-1",
        seq: 1,
        at: AT,
        type: "UPDATE_CARD",
        actorId: "user-2",
        cardId: "card-1",
      },
      {
        source: "activity",
        id: "act-1",
        at: AT - 1_000,
        type: "comment_added",
        actorId: "user-3",
        cardId: "card-1",
      },
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderActivity();

    await waitFor(() => {
      expect(
        screen.getByTestId("activity-tab-comments-count"),
      ).toHaveTextContent("2");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("activity-tab-history-count"),
      ).toHaveTextContent("2");
    });

    // Switching to History works and the comments tab keeps its state.
    fireEvent.click(screen.getByTestId("activity-tab-history"));
    expect(screen.getByTestId("history-list")).toBeTruthy();
    fireEvent.click(screen.getByTestId("activity-tab-comments"));
    expect(screen.getByTestId("comment-input")).toBeTruthy();
  });
});
