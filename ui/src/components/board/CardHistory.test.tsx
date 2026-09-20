import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityFeedEntry, CardActivityEvent } from "@janosik/shared";

import { api } from "@/api/client";
import { CardHistory } from "@/components/board/CardHistory";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardLiveProvider, createBoardLive } from "@/store/board-live";
import { FakeServer } from "@/test/fake-server";
import { foldHistory } from "@/utils/history-fold";

/**
 * The History view (TASK-37): server feed rows with "from → to" diffs,
 * per-keystroke folding, cursor pagination and the local-timeline fallback.
 */

const AT = 1_700_000_000_000;

function renderHistory() {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <CardHistory cardId="card-1" boardId="b-1" updatedAt={1} />
      </TooltipProvider>
    </I18nProvider>,
  );
}

function commandEntry(
  overrides: Partial<ActivityFeedEntry> = {},
): ActivityFeedEntry {
  return {
    source: "command",
    id: "command-1",
    seq: 1,
    at: AT,
    type: "UPDATE_CARD",
    actorId: "user-2",
    cardId: "card-1",
    ...overrides,
  };
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

describe("foldHistory", () => {
  it("folds consecutive quiet edits into one old → new row", () => {
    const folded = foldHistory([
      commandEntry({
        id: "e3",
        at: 1_000,
        changes: [{ field: "title", from: "ab", to: "abc" }],
      }),
      commandEntry({
        id: "e2",
        at: 900,
        changes: [{ field: "title", from: "a", to: "ab" }],
      }),
      commandEntry({
        id: "e1",
        at: 800,
        changes: [{ field: "title", from: "", to: "a" }],
      }),
    ]);
    expect(folded).toHaveLength(1);
    expect(folded[0].changes).toEqual([
      { field: "title", from: "", to: "abc" },
    ]);
  });

  it("keeps different actors and distant edits apart, drops touches", () => {
    const folded = foldHistory([
      commandEntry({ id: "e4", at: 10_000 }),
      commandEntry({ id: "e3", at: 9_000, actorId: "user-3" }),
      commandEntry({ id: "e2", at: 8_000 }),
      commandEntry({ id: "e1", at: 5_000 }),
      commandEntry({ id: "touch", at: 4_000, type: "TOUCH_CARD" }),
    ]);
    expect(folded.map((entry) => entry.id)).toEqual(["e4", "e3", "e2", "e1"]);
  });
});

describe("CardHistory", () => {
  it("renders sentences and from → to diffs from the server feed", async () => {
    const server = new FakeServer();
    server.seedActivity("card-1", [
      commandEntry({
        id: "rename",
        changes: [{ field: "title", from: "Old", to: "New" }],
      }),
      commandEntry({
        id: "move",
        type: "MOVE_CARD",
        detail: "Done",
        changes: [{ field: "column", from: "Todo", to: "Done" }],
      }),
      {
        source: "activity",
        id: "comment",
        at: AT - 5_000,
        type: "comment_added",
        actorId: "user-3",
        cardId: "card-1",
      },
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderHistory();

    expect(await screen.findByText("Title changed")).toBeInTheDocument();
    expect(screen.getByText("Moved to Done")).toBeInTheDocument();
    expect(screen.getByText("Added a comment")).toBeInTheDocument();

    const diffs = screen.getAllByTestId("history-diff");
    expect(diffs[0]).toHaveTextContent("Title");
    expect(diffs[0]).toHaveTextContent("Old");
    expect(diffs[0]).toHaveTextContent("New");
    expect(diffs[1]).toHaveTextContent("Column");
    expect(diffs[1]).toHaveTextContent("Todo");
    expect(diffs[1]).toHaveTextContent("Done");
  });

  it("renders the priority sentence with the localized level name", async () => {
    const server = new FakeServer();
    server.seedActivity("card-1", [
      commandEntry({
        id: "priority",
        type: "SET_CARD_PRIORITY",
        changes: [{ field: "priority", from: "medium", to: "blocker" }],
      }),
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderHistory();

    expect(
      await screen.findByText("Priority changed to Blocker"),
    ).toBeInTheDocument();

    const diffs = screen.getAllByTestId("history-diff");
    expect(diffs[0]).toHaveTextContent("Priority");
    expect(diffs[0]).toHaveTextContent("Medium");
    expect(diffs[0]).toHaveTextContent("Blocker");
  });

  it("renders the assignee sentence with the member fallback (TASK-49)", async () => {
    const server = new FakeServer();
    server.seedActivity("card-1", [
      commandEntry({
        id: "assign",
        type: "SET_CARD_ASSIGN",
        changes: [{ field: "assignee", from: null, to: "u-boris" }],
      }),
      commandEntry({
        id: "unassign",
        seq: 2,
        type: "SET_CARD_ASSIGN",
        changes: [{ field: "assignee", from: "u-boris", to: null }],
      }),
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderHistory();

    // The member directory is empty here — the raw id surfaces as the
    // name fallback; the unassign half reads as the localized sentence.
    expect(
      await screen.findByText("Assignee changed to u-boris"),
    ).toBeInTheDocument();
    expect(screen.getByText("Removed the assignee")).toBeInTheDocument();
    const diffs = screen.getAllByTestId("history-diff");
    expect(diffs[0]).toHaveTextContent("Assignee");
    expect(diffs[0]).toHaveTextContent("u-boris");
  });

  it("highlights only the changed fragment of a long description", async () => {
    const server = new FakeServer();
    const wall = "0123456789".repeat(10); // 100 identical chars on both sides
    server.seedActivity("card-1", [
      commandEntry({
        id: "desc",
        changes: [
          {
            field: "description",
            from: `${wall}A${wall}`,
            to: `${wall}B${wall}`,
          },
        ],
      }),
    ]);
    vi.stubGlobal("fetch", server.handle);
    renderHistory();

    expect(await screen.findByText("Description changed")).toBeInTheDocument();
    const diff = screen.getByTestId("history-diff");
    expect(diff).toHaveTextContent("…");
    expect(screen.getByText("A")).toHaveAttribute("data-diff", "removed");
    expect(screen.getByText("B")).toHaveAttribute("data-diff", "added");
  });

  it("loads older pages with the cursor", async () => {
    const server = new FakeServer();
    server.seedActivity(
      "card-1",
      Array.from({ length: 51 }, (_, index) =>
        commandEntry({
          id: `entry-${index}`,
          at: AT - index * 3_000,
          changes: [{ field: "title", from: `a${index}`, to: `b${index}` }],
        }),
      ),
    );
    vi.stubGlobal("fetch", server.handle);
    renderHistory();

    expect(await screen.findAllByTestId("history-entry")).toHaveLength(50);
    fireEvent.click(screen.getByTestId("history-show-older"));
    await waitFor(() =>
      expect(screen.getAllByTestId("history-entry")).toHaveLength(51),
    );
  });

  it("falls back to the local timeline without a server", () => {
    vi.unstubAllEnvs();
    const local: CardActivityEvent[] = [
      { id: "e1", type: "created", at: AT - 100, actorId: null },
      {
        id: "e2",
        type: "renamed",
        at: AT,
        actorId: "user-2",
        detail: "",
      },
    ];
    render(
      <I18nProvider>
        <TooltipProvider>
          <CardHistory
            cardId="card-1"
            boardId="b-1"
            updatedAt={AT}
            localActivity={local}
          />
        </TooltipProvider>
      </I18nProvider>,
    );

    expect(screen.getByText("Title changed")).toBeInTheDocument();
    expect(screen.getByText("Created")).toBeInTheDocument();
  });

  it("refetches the moment one of the card's commands commits", async () => {
    const server = new FakeServer();
    server.seedActivity("card-1", [commandEntry({ id: "first" })]);
    const live = createBoardLive();
    vi.stubGlobal("fetch", server.handle);
    render(
      <I18nProvider>
        <BoardLiveProvider live={live}>
          <TooltipProvider>
            <CardHistory cardId="card-1" boardId="b-1" updatedAt={1} />
          </TooltipProvider>
        </BoardLiveProvider>
      </I18nProvider>,
    );
    expect(await screen.findByTestId("history-entry")).toBeInTheDocument();

    // The command settled on the server and the feed gained a row — the
    // commit signal alone must surface it (no further edits, no blur).
    server.seedActivity("card-1", [
      commandEntry({
        id: "second",
        type: "SET_CHECKLIST_ITEM_DONE",
        detail: "item",
        at: AT + 1_000,
      }),
    ]);
    act(() => {
      live.commits.publish("b-1", ["card-1"]);
    });
    await waitFor(() =>
      expect(screen.getAllByTestId("history-entry")).toHaveLength(2),
    );
  });
});
