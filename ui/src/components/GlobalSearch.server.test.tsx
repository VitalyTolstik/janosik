import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Board,
  WorkspaceSearchMatch,
  WorkspaceSearchResult,
} from "@janosik/shared";

import { api } from "@/api/client";
import { GlobalSearch } from "@/components/GlobalSearch";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";

/**
 * Server-side comment/attachment search in the palette (TASK-177.13): one
 * bounded cross-board request, typed badges, deep links to the exact row and
 * last-response-wins across a fast query change.
 */

const boardsRef = vi.hoisted(() => ({
  current: [] as Board[],
}));
const pendingBoardCountRef = vi.hoisted(() => ({ current: 0 }));

vi.mock("@/store/BoardContext", () => ({
  useBoard: () => ({
    boards: boardsRef.current,
    pendingBoardCount: pendingBoardCountRef.current,
  }),
}));

function workspace(
  matches: WorkspaceSearchMatch[],
  total = matches.length,
  truncated = false,
): WorkspaceSearchResult {
  return { matches, total, truncated };
}

function makeBoard(cards: Array<{ id: string; title: string }>): Board {
  return {
    id: "b-1",
    title: "Alpha",
    columns: [
      {
        id: "col-1",
        title: "To do",
        cardIds: cards.map((card) => card.id),
        createdAt: 1,
      },
    ],
    cards: Object.fromEntries(
      cards.map((card) => [
        card.id,
        {
          id: card.id,
          title: card.title,
          labelIds: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    ),
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return (
    <div data-testid="loc">
      {pathname}
      {search}
    </div>
  );
}

function renderPalette() {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/board/b-1"]}>
          <GlobalSearch />
          <LocationProbe />
        </MemoryRouter>
      </TooltipProvider>
    </I18nProvider>,
  );
}

async function openAndType(query: string) {
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const input = await screen.findByTestId("global-search-input");
  fireEvent.change(input, { target: { value: query } });
  return input;
}

describe("GlobalSearch server matches (TASK-177.13)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    pendingBoardCountRef.current = 0;
    boardsRef.current = [
      makeBoard([
        { id: "c-1", title: "Landing redesign" },
        { id: "c-2", title: "Newsletter" },
      ]),
    ];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("runs full-text search after leaving command mode without sending a command query", async () => {
    const search = vi
      .spyOn(api, "searchWorkspaceMatches")
      .mockResolvedValue(workspace([]));
    renderPalette();
    const input = await openAndType("> switch");
    expect(screen.getByRole("option", { name: "Switch board" })).toBeVisible();
    // Let the normal debounce window pass with command mode active.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(search).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Newsletter" } });
    expect(
      await screen.findByRole("option", { name: /Newsletter/ }),
    ).toBeVisible();
    expect(search).toHaveBeenCalledExactlyOnceWith("Newsletter");
  });

  it("shows a Comment badge, a snippet and a comment deep link", async () => {
    const search = vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace([
        {
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: "c-1",
          cardTitle: "Landing redesign",
          matchIn: "comment",
          text: "the flaky deploy",
          commentId: "cm-1",
        },
      ]),
    );

    renderPalette();
    await openAndType("flaky");
    const option = await screen.findByRole("option");

    expect(option).toHaveTextContent("Landing redesign");
    expect(option).toHaveTextContent("Comment");
    expect(option).toHaveTextContent("In a comment:");
    expect(option).toHaveTextContent("flaky");
    expect(within(option).getByTestId("search-type-badge")).toHaveAttribute(
      "data-type",
      "comment",
    );
    expect(search).toHaveBeenCalledWith("flaky");

    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        "/board/b-1?card=c-1&comment=cm-1",
      ),
    );
  });

  it("shows an Attachment badge and a file deep link", async () => {
    vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace([
        {
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: "c-2",
          cardTitle: "Newsletter",
          matchIn: "attachment",
          text: "flaky-report.pdf",
          attachmentId: "at-1",
        },
      ]),
    );

    renderPalette();
    await openAndType("flaky");
    const option = await screen.findByRole("option");
    expect(option).toHaveTextContent("Attachment");
    expect(option).toHaveTextContent("Attachment:");
    expect(within(option).getByTestId("search-type-badge")).toHaveAttribute(
      "data-type",
      "attachment",
    );

    fireEvent.click(option);
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        "/board/b-1?card=c-2&attachment=at-1",
      ),
    );
  });

  it("falls back to the card when a server hit has no row id", async () => {
    // Older servers answered without the row id; the UI must still navigate.
    vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace([
        {
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: "c-1",
          cardTitle: "Landing redesign",
          matchIn: "comment",
          text: "flaky",
        } as unknown as WorkspaceSearchMatch,
      ]),
    );

    renderPalette();
    await openAndType("flaky");
    fireEvent.click(await screen.findByRole("option"));
    await waitFor(() =>
      expect(screen.getByTestId("loc")).toHaveTextContent(
        "/board/b-1?card=c-1",
      ),
    );
    expect(screen.getByTestId("loc")).not.toHaveTextContent("comment=");
  });

  it("caps server hits per group and expands them with Show all", async () => {
    const cards = Array.from({ length: 21 }, (_, index) => ({
      id: `c-${index}`,
      title: `Comment card ${String(index).padStart(2, "0")}`,
    }));
    boardsRef.current = [makeBoard(cards)];
    vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace(
        cards.map((card, index) => ({
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: card.id,
          cardTitle: card.title,
          matchIn: "comment" as const,
          text: `flaky note ${index}`,
          commentId: `cm-${index}`,
        })),
      ),
    );

    renderPalette();
    await openAndType("flaky");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20));
    expect(
      screen.getByRole("group", { name: "Cards, 20 of 21" }),
    ).toBeVisible();
    expect(screen.getByText("20 of 21")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(21));
  });

  it("shows a pending row instead of an empty state and announces the merge", async () => {
    let release!: (value: WorkspaceSearchResult) => void;
    const pending = new Promise<WorkspaceSearchResult>((resolve) => {
      release = resolve;
    });
    vi.spyOn(api, "searchWorkspaceMatches").mockReturnValue(pending);

    renderPalette();
    await openAndType("flaky");
    expect(
      await screen.findByTestId("search-server-pending"),
    ).toHaveTextContent("Searching comments and attachments…");
    expect(screen.queryByText("Nothing found.")).toBeNull();
    expect(screen.queryByTestId("search-results-status")).toBeNull();

    await act(async () => {
      release(
        workspace([
          {
            boardId: "b-1",
            boardTitle: "Alpha",
            cardId: "c-1",
            cardTitle: "Landing redesign",
            matchIn: "comment",
            text: "flaky deploy",
            commentId: "cm-1",
          },
        ]),
      );
    });

    expect(await screen.findByRole("option")).toHaveTextContent(
      "Landing redesign",
    );
    expect(screen.queryByTestId("search-server-pending")).toBeNull();
    expect(screen.getByTestId("search-results-status")).toHaveTextContent(
      "Cards: 1; boards: 0.",
    );
  });

  it("says when comment and file matches were truncated", async () => {
    vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace(
        [
          {
            boardId: "b-1",
            boardTitle: "Alpha",
            cardId: "c-1",
            cardTitle: "Landing redesign",
            matchIn: "comment",
            text: "flaky deploy",
            commentId: "cm-1",
          },
        ],
        201,
        true,
      ),
    );

    renderPalette();
    await openAndType("flaky");
    expect(
      await screen.findByTestId("search-server-truncated"),
    ).toHaveTextContent("Showing 1 of 201 comment and file matches.");
  });

  it("stays partial instead of empty while a matched board hydrates", async () => {
    pendingBoardCountRef.current = 1;
    const search = vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace([
        {
          boardId: "b-missing",
          boardTitle: "Not loaded",
          cardId: "c-missing",
          cardTitle: "Hidden hit",
          matchIn: "comment",
          text: "flaky deploy",
          commentId: "cm-hidden",
        },
      ]),
    );

    renderPalette();
    await openAndType("flaky");
    await waitFor(() => expect(search).toHaveBeenCalledWith("flaky"));
    await waitFor(() =>
      expect(screen.queryByTestId("search-server-pending")).toBeNull(),
    );

    expect(screen.queryByRole("option")).toBeNull();
    expect(screen.queryByText("Nothing found.")).toBeNull();
    expect(screen.queryByTestId("search-results-status")).toBeNull();
    expect(screen.getByTestId("search-boards-loading")).toBeInTheDocument();
  });

  it("shows only as many truncated hits as the default cap renders", async () => {
    const cards = Array.from({ length: 200 }, (_, index) => ({
      id: `c-many-${index}`,
      title: `Many card ${String(index).padStart(3, "0")}`,
    }));
    boardsRef.current = [makeBoard(cards)];
    vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace(
        cards.map((card, index) => ({
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: card.id,
          cardTitle: card.title,
          matchIn: "comment" as const,
          text: `flaky note ${index}`,
          commentId: `cm-${index}`,
        })),
        201,
        true,
      ),
    );

    renderPalette();
    await openAndType("flaky");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(20));
    expect(screen.getByTestId("search-server-truncated")).toHaveTextContent(
      "Showing 20 of 201 comment and file matches.",
    );

    fireEvent.click(screen.getByRole("button", { name: "Show all results" }));
    await waitFor(() =>
      expect(screen.getAllByRole("option")).toHaveLength(200),
    );
    expect(screen.getByTestId("search-server-truncated")).toHaveTextContent(
      "Showing 200 of 201 comment and file matches.",
    );
  });

  it("does not claim hidden matches are shown while boards load", async () => {
    pendingBoardCountRef.current = 1;
    vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace(
        [
          {
            boardId: "b-1",
            boardTitle: "Alpha",
            cardId: "c-1",
            cardTitle: "Landing redesign",
            matchIn: "comment",
            text: "flaky deploy",
            commentId: "cm-1",
          },
          {
            boardId: "b-missing",
            boardTitle: "Not loaded",
            cardId: "c-missing",
            cardTitle: "Hidden hit",
            matchIn: "attachment",
            text: "flaky.pdf",
            attachmentId: "at-hidden",
          },
        ],
        201,
        true,
      ),
    );

    renderPalette();
    await openAndType("flaky");
    await screen.findByTestId("search-server-truncated");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByTestId("search-server-truncated")).toHaveTextContent(
      "The server found 201 comment and file matches; some boards are still loading.",
    );
    expect(screen.getByTestId("search-server-truncated")).not.toHaveTextContent(
      "Showing 1 of 201",
    );
  });

  it("ignores a stale response that lands after a newer query", async () => {
    let resolveOld!: (
      value: Awaited<ReturnType<typeof api.searchWorkspaceMatches>>,
    ) => void;
    let resolveNew!: (
      value: Awaited<ReturnType<typeof api.searchWorkspaceMatches>>,
    ) => void;
    const oldResponse = new Promise<
      Awaited<ReturnType<typeof api.searchWorkspaceMatches>>
    >((resolve) => {
      resolveOld = resolve;
    });
    const newResponse = new Promise<
      Awaited<ReturnType<typeof api.searchWorkspaceMatches>>
    >((resolve) => {
      resolveNew = resolve;
    });
    const search = vi
      .spyOn(api, "searchWorkspaceMatches")
      .mockImplementation((query) =>
        query === "flaky" ? oldResponse : newResponse,
      );

    renderPalette();
    const input = await openAndType("flaky");
    await waitFor(() => expect(search).toHaveBeenCalledWith("flaky"));

    fireEvent.change(input, { target: { value: "glitch" } });
    await waitFor(() => expect(search).toHaveBeenCalledWith("glitch"));

    resolveNew(
      workspace([
        {
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: "c-2",
          cardTitle: "Newsletter",
          matchIn: "comment",
          text: "glitch in deploy",
          commentId: "cm-new",
        },
      ]),
    );
    const hit = await screen.findByRole("option");
    await waitFor(() => expect(hit).toHaveTextContent("glitch in deploy"));

    resolveOld(
      workspace([
        {
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: "c-1",
          cardTitle: "Landing redesign",
          matchIn: "comment",
          text: "flaky note",
          commentId: "cm-old",
        },
      ]),
    );
    await waitFor(() => expect(hit).toHaveTextContent("glitch in deploy"));
    expect(hit).not.toHaveTextContent("flaky note");
    expect(screen.queryByText("Landing redesign")).toBeNull();
  });
});

describe("GlobalSearch server content matches (TASK-200.9)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
    pendingBoardCountRef.current = 0;
    boardsRef.current = [
      makeBoard([
        { id: "c-1", title: "Landing redesign" },
        { id: "c-2", title: "Newsletter" },
      ]),
    ];
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("renders a description snippet from the workspace match", async () => {
    vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace([
        {
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: "c-1",
          cardTitle: "Landing redesign",
          matchIn: "description",
          text: "The hero mockups are ready",
        },
      ]),
    );

    renderPalette();
    await openAndType("mockups");
    const option = await screen.findByRole("option");

    expect(option).toHaveTextContent("Landing redesign");
    expect(option).toHaveTextContent("The hero mockups are ready");
  });

  it("renders a checklist item text from the workspace match", async () => {
    vi.spyOn(api, "searchWorkspaceMatches").mockResolvedValue(
      workspace([
        {
          boardId: "b-1",
          boardTitle: "Alpha",
          cardId: "c-2",
          cardTitle: "Newsletter",
          matchIn: "checklist",
          text: "run the widget migration",
        },
      ]),
    );

    renderPalette();
    await openAndType("widget");
    const option = await screen.findByRole("option");

    expect(option).toHaveTextContent("Newsletter");
    expect(option).toHaveTextContent("run the widget migration");
  });
});
