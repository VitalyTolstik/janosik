import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { I18nProvider } from "@/i18n";
import i18n, { ensureLocale } from "@/i18n/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import { adminMessage } from "./admin-i18n";
import {
  FakeAdminServer,
  adminActivity,
  adminAttachment,
  adminBoard,
  adminCard,
  adminCardLink,
  adminComment,
  adminLabel,
  adminUser,
  boardMember,
  emptyAdminState,
} from "./test/fake-admin-server";

/**
 * TASK-176.5 + 176.6 — the list URL is the source of truth: restore it on
 * load/back/forward, keep the hub tab, apply exact board/column filters and
 * carry the filtered page into a detail and back.
 */

const t = (
  key: Parameters<typeof adminMessage>[0],
  params?: Record<string, string | number>,
) => adminMessage(key, "en", params);

function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location-probe">
      {`${location.pathname}${location.search}`}
    </output>
  );
}

function HistoryButtons() {
  const navigate = useNavigate();
  return (
    <span>
      <button
        type="button"
        data-testid="test-back"
        onClick={() => navigate(-1)}
      >
        back
      </button>
      <button
        type="button"
        data-testid="test-forward"
        onClick={() => navigate(1)}
      >
        forward
      </button>
    </span>
  );
}

function renderAdmin(initialPath: string) {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[initialPath]}>
              <Routes>
                <Route
                  path="/admin/*"
                  element={
                    <>
                      <AdminApp />
                      <LocationProbe />
                      <HistoryButtons />
                    </>
                  }
                />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

function stateWithTwoBoards() {
  const state = emptyAdminState();
  state.boards = [
    adminBoard({ id: "b-1", title: "Same name" }),
    adminBoard({ id: "b-2", title: "Same name" }),
  ];
  state.cards = [
    adminCard({ id: "card-1", boardId: "b-1", columnId: "col-1" }),
    adminCard({
      id: "card-2",
      boardId: "b-2",
      columnId: "col-2",
      title: "Moderate me too",
    }),
  ];
  return state;
}

function lastRequest(server: FakeAdminServer, path: string) {
  const requests = server.requests.filter((request) => request.path === path);
  return requests[requests.length - 1];
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  adminApi.clearAccessToken();
  adminApi.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("admin list URL state", () => {
  it("restores search, status, page size and the exact board filter", async () => {
    const state = stateWithTwoBoards();
    state.cards[1].archivedAt = 1;
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin(
      "/admin/boards?tab=cards&search=moderate&status=archived&limit=25&boardId=b-2",
    );

    expect(await screen.findByTestId("admin-card-row-card-2")).toBeTruthy();
    expect(screen.queryByTestId("admin-card-row-card-1")).toBeNull();
    expect(screen.getByPlaceholderText(t("admin.common.search"))).toHaveValue(
      "moderate",
    );
    expect(screen.getByTestId("admin-page-size")).toHaveValue("25");
    expect(
      screen.getByRole("button", { name: t("admin.boards.filter.archived") }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent(
        "b-2",
      );
    });

    await waitFor(() => {
      const request = lastRequest(server, "/admin/entities/cards");
      expect(request?.query.get("search")).toBe("moderate");
      expect(request?.query.get("status")).toBe("archived");
      expect(request?.query.get("limit")).toBe("25");
      expect(request?.query.get("boardId")).toBe("b-2");
    });
  });

  it("writes filter changes to the URL and restores them on back/forward", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards&search=moderate&boardId=b-2");

    await screen.findByTestId("admin-card-row-card-2");
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.boards.filter.archived") }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "status=archived",
      );
    });
    expect(screen.getByTestId("location-probe")).toHaveTextContent("tab=cards");
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "boardId=b-2",
    );

    fireEvent.click(screen.getByTestId("test-back"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).not.toHaveTextContent(
        "status=archived",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent(
        "b-2",
      );
    });
    await waitFor(() => {
      expect(
        lastRequest(server, "/admin/entities/cards")?.query.get("status"),
      ).toBeNull();
    });

    fireEvent.click(screen.getByTestId("test-forward"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "status=archived",
      );
    });
  });

  it("clears a structural filter and drops it from the URL", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards&boardId=b-2");

    expect(await screen.findByTestId("admin-card-row-card-2")).toBeTruthy();
    expect(screen.queryByTestId("admin-card-row-card-1")).toBeNull();

    fireEvent.click(screen.getByTestId("admin-filter-clear-boardId"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).not.toHaveTextContent(
        "boardId",
      );
    });
    expect(await screen.findByTestId("admin-card-row-card-1")).toBeTruthy();
    expect(screen.queryByTestId("admin-filter-banner")).toBeNull();
    await waitFor(() => {
      expect(
        lastRequest(server, "/admin/entities/cards")?.query.get("boardId"),
      ).toBeNull();
    });
  });

  it("restores the period window from the URL", async () => {
    const state = emptyAdminState();
    state.activity = [adminActivity()];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/audit?tab=activity&period=7d");

    expect(
      await screen.findByRole("button", { name: t("admin.filter.period.7d") }),
    ).toHaveAttribute("aria-pressed", "true");
    await waitFor(() => {
      const request = lastRequest(server, "/admin/entities/activity");
      const from = Number(request?.query.get("from"));
      expect(Number.isFinite(from)).toBe(true);
      expect(from).toBeGreaterThan(Date.now() - 7 * 24 * 3_600_000 - 5_000);
      expect(from).toBeLessThan(Date.now() - 7 * 24 * 3_600_000 + 5_000);
    });
    expect(screen.getByTestId("location-probe")).toHaveTextContent("period=7d");
  });

  it("clears bulk selection when the filter changes via history", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards");

    await screen.findByTestId("admin-card-row-card-1");
    fireEvent.click(
      screen.getByRole("button", { name: t("admin.boards.filter.archived") }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "status=archived",
      );
    });
    fireEvent.click(screen.getByTestId("test-back"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).not.toHaveTextContent(
        "status=archived",
      );
    });

    fireEvent.click(await screen.findByTestId("admin-select-card-1"));
    expect(await screen.findByTestId("admin-bulk-delete")).toBeTruthy();

    fireEvent.click(screen.getByTestId("test-forward"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "status=archived",
      );
    });
    await waitFor(() => {
      expect(screen.queryByTestId("admin-bulk-delete")).toBeNull();
    });
  });

  it("keeps a cell link from being stolen by the row link", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards");

    const row = await screen.findByTestId("admin-card-row-card-2");
    const boardLink = row.querySelector('a[href^="/admin/boards/b-2"]');
    expect(boardLink).not.toBeNull();
    fireEvent.click(boardLink as Element);

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/admin/boards/b-2",
      );
    });
    expect(screen.getByTestId("location-probe")).not.toHaveTextContent(
      "/admin/cards/card-2",
    );
  });

  it("carries the filtered list into a card and back", async () => {
    const server = new FakeAdminServer(stateWithTwoBoards());
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards?tab=cards&search=moderate&boardId=b-2");

    fireEvent.click(await screen.findByTestId("admin-card-row-card-2"));
    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/admin/cards/card-2?returnTo=",
      );
    });
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      encodeURIComponent("/admin/boards?tab=cards&search=moderate&boardId=b-2"),
    );

    const back = screen.getByRole("link", { name: t("admin.common.back") });
    expect(back).toHaveAttribute(
      "href",
      "/admin/boards?tab=cards&search=moderate&boardId=b-2",
    );
    fireEvent.click(back);

    await waitFor(() => {
      expect(screen.getByTestId("location-probe")).toHaveTextContent(
        "/admin/boards?tab=cards&search=moderate&boardId=b-2",
      );
    });
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent(
        "b-2",
      );
    });
    expect(screen.getByPlaceholderText(t("admin.common.search"))).toHaveValue(
      "moderate",
    );
  });
});

const boardA = "board-AA-extended";
const boardB = "board-BB-extended";
const columnA = "column-A-extended";
const columnB = "column-B-extended";
const labelA = "label-AA-extended";
const labelB = "label-BB-extended";
const cardA = "card-AAA-extended";
const cardsUrl = "/admin/boards?tab=cards";

function filterServer() {
  const state = emptyAdminState();
  state.boards = [boardA, boardB].map((id) =>
    adminBoard({ id, title: "Design system" }),
  );
  state.cards = [
    adminCard({ id: cardA, boardId: boardA, columnId: columnA }),
    adminCard({ id: "card-BBB", boardId: boardB, columnId: columnB }),
    adminCard({ id: "card-AAA-other", boardId: boardA, columnId: columnA }),
  ];
  state.cardLabelIds[cardA] = [labelA];
  const server = new FakeAdminServer(state);
  for (const [boardId, columnId, labelId] of [
    [boardA, columnA, labelA],
    [boardB, columnB, labelB],
    [boardA, "column-C-duplicate", "label-CC-duplicate"],
  ]) {
    (server.boardColumns[boardId] ??= []).push({
      id: columnId,
      boardId,
      boardTitle: "Design system",
      title: "In progress",
      wipLimit: null,
      position: 0,
      cardCount: 1,
      deletedAt: null,
      version: 0,
      createdAt: 1,
      updatedAt: 1,
    });
    (server.boardLabels[boardId] ??= []).push(
      adminLabel({
        id: labelId,
        boardId,
        boardTitle: "Design system",
        name: "urgent",
      }),
    );
  }
  vi.stubGlobal("fetch", server.fetchImpl);
  return server;
}

function currentQuery() {
  return new URLSearchParams(
    screen.getByTestId("location-probe").textContent?.split("?")[1],
  );
}

async function openFacet(facet: string) {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: /^Filters/ }));
  const dialog = await screen.findByRole("dialog", {
    name: "Filters for cards",
  });
  await user.click(within(dialog).getByRole("button", { name: facet }));
  return within(dialog);
}

describe("cards filter bar", () => {
  it("adds exact board, column and single label, shows names and context, and restores them through history", async () => {
    const server = filterServer();
    const user = userEvent.setup();
    renderAdmin(`${cardsUrl}&limit=1&offset=1&returnTo=%2Fadmin`);
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        "Results: 3",
      );
    });

    const boards = await openFacet("Board");
    expect(
      await boards.findAllByRole("option", { name: /Design system/ }),
    ).toHaveLength(2);
    await user.click(
      boards.getByRole("option", { name: /Design system.*board-AA/ }),
    );
    expect(
      await screen.findByRole("button", {
        name: /Remove filter: Board.*Design system.*board-AA/,
      }),
    ).toBeInTheDocument();
    expect(currentQuery().get("offset")).toBeNull();
    expect(currentQuery().get("returnTo")).toBe("/admin");
    await waitFor(() => {
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        /^Filters applied · Results: 2$/,
      );
    });
    expect(screen.getByTestId("admin-pagination-status")).toHaveTextContent(
      "Page 1 of 2",
    );

    const columns = await openFacet("Column");
    expect(
      await columns.findAllByRole("option", { name: /In progress/ }),
    ).toHaveLength(2);
    await user.click(
      columns.getByRole("option", { name: /In progress.*column-A.*board-AA/ }),
    );
    expect(screen.getByTestId("admin-filter-columnId")).toHaveTextContent(
      /In progress.*column-A.*board-AA/,
    );

    const labels = await openFacet("Label");
    expect(
      await labels.findAllByRole("checkbox", { name: /urgent/ }),
    ).toHaveLength(2);
    await user.click(
      labels.getByRole("checkbox", { name: /urgent.*label-AA.*board-AA/ }),
    );
    expect(currentQuery().has("labelId")).toBe(false);
    await user.click(labels.getByRole("button", { name: "Apply" }));
    const labelChip = await screen.findByRole("button", {
      name: /Remove filter: Label.*urgent.*label-AA.*board-AA/,
    });
    expect(
      labelChip.parentElement?.querySelector("[aria-hidden].rounded-full"),
    ).toBeInTheDocument();
    expect(currentQuery().getAll("labelId")).toEqual([labelA]);
    expect(
      lastRequest(server, "/admin/filter-options")?.query.has("boardId"),
    ).toBe(false);
    expect(
      lastRequest(server, "/admin/entities/cards")?.query.get("labelId"),
    ).toBe(labelA);

    await user.click(screen.getByTestId("test-back"));
    await waitFor(() => expect(currentQuery().has("labelId")).toBe(false));
    expect(currentQuery().get("columnId")).toBe(columnA);
    await user.click(screen.getByTestId("test-forward"));
    await waitFor(() => expect(currentQuery().get("labelId")).toBe(labelA));
    await user.click(
      await screen.findByRole("button", {
        name: /Remove filter: Label.*urgent/,
      }),
    );
    await waitFor(() => expect(currentQuery().has("labelId")).toBe(false));
    expect(screen.getByTestId("admin-filter-clear-columnId")).toHaveFocus();
    await user.click(
      screen.getByRole("button", { name: "Clear search and filters" }),
    );
    await waitFor(() =>
      expect([...currentQuery().keys()]).toEqual(["tab", "returnTo", "limit"]),
    );
  });

  it("changes boards atomically, clears bulk selection and announces the three dependent removals", async () => {
    const server = filterServer();
    const user = userEvent.setup();
    renderAdmin(
      `${cardsUrl}&boardId=${boardA}&columnId=${columnA}&labelId=${labelA}&cardId=${cardA}`,
    );
    await user.click(await screen.findByTestId(`admin-select-${cardA}`));
    expect(screen.getByTestId("admin-bulk-delete")).toBeVisible();
    const before = server.requests.filter(
      ({ path }) => path === "/admin/entities/cards",
    ).length;
    const boards = await openFacet("Board");
    await user.click(
      await boards.findByRole("option", { name: /Design system.*board-BB/ }),
    );
    await waitFor(() => expect(currentQuery().get("boardId")).toBe(boardB));
    expect([...currentQuery().keys()]).toEqual(["tab", "boardId"]);
    expect(screen.queryByTestId("admin-bulk-delete")).not.toBeInTheDocument();
    expect(
      screen.getByText("Dependent filters cleared: 3").closest("[role=status]"),
    ).toBeInTheDocument();
    await screen.findByTestId("admin-card-row-card-BBB");
    expect(
      server.requests
        .filter(({ path }) => path === "/admin/entities/cards")
        .slice(before),
    ).toHaveLength(1);

    await user.click(screen.getByTestId("test-back"));
    await screen.findByTestId(`admin-card-row-${cardA}`);
    expect(currentQuery().get("columnId")).toBe(columnA);
    expect(currentQuery().get("labelId")).toBe(labelA);
    expect(currentQuery().get("cardId")).toBe(cardA);
    expect(screen.queryByTestId("admin-bulk-delete")).not.toBeInTheDocument();
  });

  it("keeps a conflicting deep link exact until that dependent filter is removed", async () => {
    const server = filterServer();
    renderAdmin(
      `${cardsUrl}&boardId=${boardA}&columnId=${columnB}&labelId=${labelA}`,
    );
    const conflict = await screen.findByRole("button", {
      name: "Remove conflict: Column — In progress · column-B",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Column — In progress · column-B refers to a different board or column.",
    );
    expect(screen.getByTestId("admin-filter-columnId")).toHaveTextContent(
      /In progress.*column-B.*board-BB/,
    );
    expect(currentQuery().get("columnId")).toBe(columnB);
    expect(
      lastRequest(server, "/admin/entities/cards")?.query.get("boardId"),
    ).toBe(boardA);
    expect(
      lastRequest(server, "/admin/entities/cards")?.query.get("columnId"),
    ).toBe(columnB);
    expect(
      screen.queryByTestId(`admin-card-row-${cardA}`),
    ).not.toBeInTheDocument();

    await userEvent.click(conflict);
    await screen.findByTestId(`admin-card-row-${cardA}`);
    expect(currentQuery().has("columnId")).toBe(false);
    expect(currentQuery().get("boardId")).toBe(boardA);
    expect(currentQuery().get("labelId")).toBe(labelA);
    expect(screen.getByTestId("admin-filter-clear-labelId")).toHaveFocus();
  });

  it("offers an exact unknown ID and distinguishes empty matches from an empty list", async () => {
    vi.stubGlobal("fetch", new FakeAdminServer(emptyAdminState()).fetchImpl);
    renderAdmin(cardsUrl);
    await screen.findByText("Nothing here yet");
    expect(
      screen.queryByTestId("admin-pagination-status"),
    ).not.toBeInTheDocument();
    const boards = await openFacet("Board");
    await userEvent.type(
      boards.getByRole("combobox", { name: /Board/ }),
      "missing-board",
    );
    await userEvent.click(
      await boards.findByRole("option", { name: "Use id “missing-board”" }),
    );
    expect(
      await screen.findByRole("button", {
        name: /Remove filter: Board.*Unknown board.*missing-/,
      }),
    ).toBeVisible();
    await screen.findByText("No cards match these filters.");
    expect(
      screen.queryByRole("button", { name: /^Remove conflict/ }),
    ).not.toBeInTheDocument();
    expect(currentQuery().get("boardId")).toBe("missing-board");

    await userEvent.click(
      within(screen.getByTestId("admin-empty-state")).getByRole("button", {
        name: "Clear search and filters",
      }),
    );
    await screen.findByText("Nothing here yet");
    expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus();
  });

  it("displays a retry when lookup fails, then reports zero for a valid parent combination", async () => {
    const server = filterServer();
    const unused = "label-CC-duplicate";
    server.failNext.push("/admin/filter-options");
    renderAdmin(`${cardsUrl}&boardId=${boardA}&labelId=${unused}`);
    await screen.findByText("Could not look up filter values.");
    expect(
      screen.queryByText("No cards match these filters."),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("No cards match these filters.");
    expect(currentQuery().get("labelId")).toBe(unused);
    expect(
      screen.queryByRole("button", { name: /^Remove conflict/ }),
    ).not.toBeInTheDocument();
  });

  it("removes an unsupported facet when the list API rejects it", async () => {
    const server = filterServer();
    server.failNextStatuses.push({
      path: "/admin/entities/cards",
      status: 400,
      body: { code: "unsupported_filter", filter: "labelId" },
    });
    renderAdmin(`${cardsUrl}&boardId=${boardA}&labelId=${labelA}`);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This list does not support the filter “Label”.",
    );
    const remove = await screen.findByRole("button", {
      name: "Remove filter: Label",
    });
    expect(
      screen.queryByTestId(`admin-card-row-${cardA}`),
    ).not.toBeInTheDocument();
    await userEvent.click(remove);
    await screen.findByTestId(`admin-card-row-${cardA}`);
    expect(currentQuery().has("labelId")).toBe(false);
    expect(currentQuery().get("boardId")).toBe(boardA);
    expect(screen.getByTestId("admin-filter-clear-boardId")).toHaveFocus();
  });

  it("keeps board and returnTo across a hub tab switch and drops the other list state", async () => {
    filterServer();
    renderAdmin(
      `${cardsUrl}&boardId=${boardA}&columnId=${columnA}&search=Moderate&returnTo=%2Fadmin`,
    );
    await screen.findByTestId(`admin-card-row-${cardA}`);
    await userEvent.click(screen.getByTestId("admin-hub-tab-columns"));
    await waitFor(() => expect(currentQuery().get("tab")).toBe("columns"));
    expect(currentQuery().get("boardId")).toBe(boardA);
    expect(currentQuery().get("returnTo")).toBe("/admin");
    expect(currentQuery().has("columnId")).toBe(false);
    expect(currentQuery().has("search")).toBe(false);
  });

  it("pushes a restorable view when clearing a search with no other filters", async () => {
    filterServer();
    const user = userEvent.setup();
    renderAdmin(`${cardsUrl}&search=Moderate&returnTo=%2Fadmin`);
    await user.click(await screen.findByTestId("admin-filter-clear"));
    await waitFor(() => expect(currentQuery().has("search")).toBe(false));
    expect(currentQuery().get("returnTo")).toBe("/admin");
    await user.click(screen.getByTestId("test-back"));
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Search…" })).toHaveValue(
        "Moderate",
      ),
    );
  });

  it("keeps assignee and unassigned drafts until Apply and resolves user chips", async () => {
    const server = filterServer();
    server.state.users = [
      adminUser({
        id: "user-name",
        email: "named@example.com",
        displayName: "Casey Example",
      }),
      adminUser({
        id: "user-mail",
        email: "fallback@example.com",
        displayName: null,
        disabledAt: 1,
      }),
    ];
    server.state.cards[0].assigneeId = "user-name";
    server.state.cards[1].assigneeId = "user-mail";
    const user = userEvent.setup();
    renderAdmin(cardsUrl);

    let picker = await openFacet("Assignee");
    let unassigned = picker.getByRole("checkbox", {
      name: "Unassigned assignee",
    });
    unassigned.focus();
    await user.keyboard("[Space]");
    expect(unassigned).toBeChecked();
    expect(currentQuery().has("unassigned")).toBe(false);
    await user.click(picker.getByRole("button", { name: "Cancel" }));

    picker = await openFacet("Assignee");
    unassigned = picker.getByRole("checkbox", { name: "Unassigned assignee" });
    expect(unassigned).not.toBeChecked();
    await user.click(unassigned);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(currentQuery().has("unassigned")).toBe(false);
    expect(screen.getByRole("button", { name: "Filters" })).toHaveFocus();

    picker = await openFacet("Assignee");
    expect(
      picker.getByRole("checkbox", { name: "Unassigned assignee" }),
    ).not.toBeChecked();
    await user.click(
      await picker.findByRole("checkbox", {
        name: /Casey Example.*named@example.com/,
      }),
    );
    await user.click(
      await picker.findByRole("checkbox", {
        name: /fallback@example.com.*disabled/,
      }),
    );
    await user.click(
      picker.getByRole("checkbox", { name: "Unassigned assignee" }),
    );
    await user.click(picker.getByRole("button", { name: "Apply" }));
    expect(currentQuery().getAll("assigneeId")).toEqual([
      "user-mail",
      "user-name",
    ]);
    expect(currentQuery().get("unassigned")).toBe("true");
    expect(screen.getByRole("button", { name: "Filters 1" })).toHaveFocus();
    expect(screen.getByTestId("admin-filter-unassigned")).toHaveTextContent(
      /^Unassigned$/,
    );
    expect(
      await screen.findByRole("button", {
        name: /Remove filter: Assignee.*Casey Example.*user-nam/,
      }),
    ).toBeVisible();
    expect(
      await screen.findByRole("button", {
        name: /Remove filter: Assignee.*fallback@example.com.*disabled/,
      }),
    ).toBeVisible();
    const remove = screen.getByRole("button", {
      name: "Remove filter: Unassigned",
    });
    remove.focus();
    await user.keyboard("{Enter}");
    expect(currentQuery().has("unassigned")).toBe(false);
    expect(currentQuery().getAll("assigneeId")).toEqual([
      "user-mail",
      "user-name",
    ]);
    await waitFor(() =>
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        /^Filters applied · Results: 2$/,
      ),
    );
  });

  it("keeps selected labels checked while resolving them outside the search results", async () => {
    const server = filterServer();
    const fetch = server.fetchImpl;
    const missing = "missing-label";
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input));
        if (
          url.pathname.endsWith("/admin/filter-options") &&
          url.searchParams.getAll("ids").includes(missing)
        ) {
          await gate;
        }
        return fetch(input, init);
      },
    );
    renderAdmin(
      `${cardsUrl}&boardId=${boardA}&labelId=${labelA}&labelId=${missing}`,
    );

    const picker = await openFacet("Label");
    expect(
      await picker.findByRole("checkbox", { name: /urgent.*label-AA/ }),
    ).toBeChecked();
    await userEvent.type(
      picker.getByRole("searchbox", { name: "Search options — Label" }),
      "no such label",
    );
    await waitFor(() =>
      expect(
        picker.queryByText("Looking up values…", { exact: true }),
      ).not.toBeInTheDocument(),
    );
    for (const id of ["label-AA", "missing-"]) {
      expect(
        picker.getByRole("checkbox", {
          name: `Looking up values… · ${id}`,
        }),
      ).toBeChecked();
    }
    expect(picker.queryByText(/Unknown label/)).not.toBeInTheDocument();
    expect(picker.queryByText("No options found.")).not.toBeInTheDocument();

    release();
    expect(
      await picker.findByRole("checkbox", { name: /urgent.*label-AA/ }),
    ).toBeChecked();
    expect(
      picker.getByRole("checkbox", {
        name: "Unknown label · missing-",
      }),
    ).toBeChecked();
    expect(picker.queryByText("No options found.")).not.toBeInTheDocument();
  });

  it("commits label mode once, discards changed drafts and removes All with one remaining label", async () => {
    const server = filterServer();
    const secondLabel = "label-CC-duplicate";
    server.state.cardLabelIds[cardA].push(secondLabel);
    server.state.cardLabelIds["card-AAA-other"] = [labelA];
    const user = userEvent.setup();
    renderAdmin(`${cardsUrl}&boardId=${boardA}&labelId=${labelA}`);

    let picker = await openFacet("Label");
    expect(
      picker.queryByRole("radiogroup", { name: "Label match mode" }),
    ).not.toBeInTheDocument();
    await user.click(await picker.findByRole("checkbox", { name: /label-CC/ }));
    const any = picker.getByRole("radio", { name: "Any label" });
    const all = picker.getByRole("radio", { name: "All labels" });
    expect(any).toHaveAttribute("aria-checked", "true");
    any.focus();
    await user.keyboard("{End}");
    expect(all).toHaveFocus();
    expect(all).toHaveAttribute("aria-checked", "false");
    await user.keyboard("[Space]");
    expect(all).toHaveAttribute("aria-checked", "true");
    expect(currentQuery().getAll("labelId")).toEqual([labelA]);
    expect(currentQuery().has("labelMatch")).toBe(false);
    await user.click(picker.getByRole("button", { name: "Apply" }));

    const chip = await screen.findByRole("button", {
      name: "Remove filter: Label match — All",
    });
    expect(chip.parentElement).toHaveTextContent(/^Label match: All$/);
    expect(currentQuery().getAll("labelId")).toEqual([labelA, secondLabel]);
    expect(currentQuery().get("labelMatch")).toBe("all");
    await waitFor(() =>
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        /^Filters applied · Results: 1$/,
      ),
    );

    for (const close of ["Cancel", "Escape"]) {
      picker = await openFacet("Label");
      expect(picker.getByRole("radio", { name: "All labels" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await user.click(picker.getByRole("radio", { name: "Any label" }));
      if (close === "Cancel")
        await user.click(picker.getByRole("button", { name: close }));
      else await user.keyboard("{Escape}");
      expect(chip).toBeVisible();
      expect(currentQuery().get("labelMatch")).toBe("all");
    }
    await user.click(chip);
    expect(currentQuery().has("labelMatch")).toBe(false);
    expect(currentQuery().getAll("labelId")).toEqual([labelA, secondLabel]);
    await waitFor(() =>
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        /^Filters applied · Results: 2$/,
      ),
    );
    await user.click(screen.getByTestId("test-back"));
    await screen.findByRole("button", {
      name: "Remove filter: Label match — All",
    });
    await user.click(
      await screen.findByRole("button", {
        name: /Remove filter: Label — urgent.*label-CC/,
      }),
    );
    expect(currentQuery().getAll("labelId")).toEqual([labelA]);
    expect(currentQuery().has("labelMatch")).toBe(false);
  });

  it("preserves selection on paging and resets it for priority, period and radio filters", async () => {
    const server = filterServer();
    const recent = Date.now() - 3_600_000;
    server.state.cards[0].createdAt = recent;
    server.state.cards[1].createdAt = recent - 2 * 86_400_000;
    server.state.cards[2].priority = "high";
    server.state.attachments = [
      adminAttachment({ cardId: cardA }),
      adminAttachment({ cardId: "card-BBB", descriptionDetached: true }),
    ];
    const user = userEvent.setup();
    renderAdmin(`${cardsUrl}&period=7d&limit=1&offset=1`);
    expect(
      await screen.findByRole("button", { name: "7 days" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      await screen.findByTestId("admin-pagination-status"),
    ).toHaveTextContent("Page 2 of 2");
    await user.click(await screen.findByTestId("admin-select-card-BBB"));
    await user.click(screen.getByRole("button", { name: "Previous" }));
    await screen.findByTestId(`admin-card-row-${cardA}`);
    expect(screen.getByTestId("admin-bulk-delete")).toBeVisible();
    await user.click(screen.getByTestId("admin-pagination-next"));
    await screen.findByTestId("admin-card-row-card-BBB");

    const priority = await openFacet("Priority");
    expect(
      priority.getByText("Medium includes cards without a priority."),
    ).toBeVisible();
    const medium = priority.getByRole("checkbox", { name: "Medium" });
    medium.focus();
    await user.keyboard("[Space]");
    await user.type(
      priority.getByRole("searchbox", { name: "Search options — Priority" }),
      "high",
    );
    expect(medium).toBeChecked();
    expect(
      priority.queryByRole("checkbox", { name: "Low" }),
    ).not.toBeInTheDocument();
    await user.click(priority.getByRole("checkbox", { name: "High" }));
    expect(currentQuery().has("priority")).toBe(false);
    await user.click(priority.getByRole("button", { name: "Apply" }));
    expect(currentQuery().getAll("priority")).toEqual(["high", "medium"]);
    expect(currentQuery().has("offset")).toBe(false);
    expect(screen.queryByTestId("admin-bulk-delete")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Remove filter: Priority — High" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Remove filter: Priority — Medium" }),
    ).toBeVisible();

    await user.click(await screen.findByTestId(`admin-select-${cardA}`));
    await user.click(screen.getByRole("button", { name: "24 hours" }));
    await waitFor(() => expect(currentQuery().get("period")).toBe("24h"));
    expect(screen.queryByTestId("admin-bulk-delete")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        /^Filters applied · Results: 1$/,
      ),
    );
    const from = Number(
      lastRequest(server, "/admin/entities/cards")?.query.get("from"),
    );
    expect(from).toBeGreaterThanOrEqual(Date.now() - 86_400_000 - 1000);
    expect(from).toBeLessThanOrEqual(Date.now() - 86_400_000);
    await user.click(await screen.findByTestId(`admin-select-${cardA}`));
    const attachments = await openFacet("Card attachments");
    const group = within(
      attachments.getByRole("radiogroup", { name: "Card attachment filter" }),
    );
    const any = group.getByRole("radio", { name: "Any" });
    const has = group.getByRole("radio", { name: "Has card attachments" });
    expect(any).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(has).toHaveFocus();
    expect(has).toHaveAttribute("aria-checked", "false");
    await user.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(currentQuery().get("hasAttachments")).toBe("true");
    expect(screen.queryByTestId("admin-bulk-delete")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        /^Filters applied · Results: 1$/,
      ),
    );
  });

  it("allows clearing an over-budget cards link without sending an invalid request", async () => {
    const server = filterServer();
    const facets = new URLSearchParams();
    for (let index = 0; index < 20; index++)
      facets.append("assigneeId", `assignee-${index}`);
    for (let index = 0; index < 15; index++)
      facets.append("labelId", `label-${index}`);
    renderAdmin(`${cardsUrl}&${facets}`);

    await screen.findByText("The URL contains invalid filters.");
    await userEvent.click(
      screen.getAllByTestId("admin-filter-clear-labelId")[0],
    );
    expect(
      screen.getByText(
        "Too many filter values. Remove some values to continue.",
      ),
    ).toBeVisible();
    expect(currentQuery().getAll("labelId")).toHaveLength(15);
    expect(lastRequest(server, "/admin/entities/cards")).toBeUndefined();

    await userEvent.click(screen.getByTestId("admin-filter-clear"));
    await waitFor(() => expect([...currentQuery().keys()]).toEqual(["tab"]));
    await screen.findByTestId(`admin-card-row-${cardA}`);
  });

  it("supports keyboard selection and focus return in the Russian phone sheet", async () => {
    filterServer();
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: media === "(max-width: 639px)",
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await ensureLocale("ru");
    await i18n.changeLanguage("ru");
    const user = userEvent.setup();
    const view = renderAdmin(cardsUrl);
    try {
      const trigger = await screen.findByRole("button", { name: "Фильтры" });
      trigger.focus();
      await user.keyboard("[Space]");
      const dialog = await screen.findByRole("dialog", {
        name: "Фильтры карточек",
      });
      expect(dialog).toHaveAttribute("aria-modal", "true");
      await user.keyboard("{Escape}");
      await waitFor(() => expect(trigger).toHaveFocus());
      await user.keyboard("{Enter}");
      const facet = screen.getByRole("button", { name: "Доска" });
      await waitFor(() => expect(facet).toHaveFocus());
      await user.keyboard("{Enter}");
      const input = screen.getByRole("combobox", {
        name: "Найти значение — Доска",
      });
      expect(input).toHaveFocus();
      await screen.findByRole("option", { name: /Design system.*board-AA/ });
      await user.keyboard("{ArrowDown}{Enter}");
      await waitFor(() => expect(trigger).toHaveFocus());
      const remove = await screen.findByRole("button", {
        name: /Удалить фильтр: Доска.*Design system.*board-AA/,
      });
      await user.tab();
      // Status and period tabs precede the chips in the keyboard order.
      for (let index = 0; index < 8; index++) await user.tab();
      expect(remove).toHaveFocus();
      await user.keyboard("{Enter}");
      await waitFor(() => expect(currentQuery().get("boardId")).toBeNull());
      expect(trigger).toHaveFocus();
    } finally {
      view.unmount();
      await i18n.changeLanguage("en");
    }
  });
});

function moderationServer() {
  const state = stateWithTwoBoards();
  const now = Date.now();
  state.users = [adminUser({ displayName: "Alex Moderator" })];
  state.comments = [
    adminComment({
      id: "comment-blocked",
      text: "Blocked on review",
      kind: "blocker",
      createdAt: now,
    }),
    adminComment({
      id: "comment-question",
      text: "Who can help?",
      kind: "question",
      createdAt: now,
    }),
    adminComment({
      id: "comment-note",
      text: "An ordinary note",
      createdAt: now,
    }),
  ];
  state.attachments = [
    adminAttachment({ fileName: "inline.png", isInline: true, createdAt: now }),
    adminAttachment({
      id: "attachment-detached",
      fileName: "detached.png",
      descriptionDetached: true,
      createdAt: now,
    }),
  ];
  const server = new FakeAdminServer(state);
  server.sessionRole = "OPERATOR";
  vi.stubGlobal("fetch", server.fetchImpl);
  return server;
}

async function openListFacet(
  user: ReturnType<typeof userEvent.setup>,
  title: string,
  facet: string,
  trigger = /^Filters/,
) {
  await user.click(await screen.findByRole("button", { name: trigger }));
  const dialog = within(await screen.findByRole("dialog", { name: title }));
  await user.click(dialog.getByRole("button", { name: facet }));
  return dialog;
}

describe("content list filters", () => {
  it.each(["en", "ru"] as const)(
    "uses the %s verification radio, combines it with period, and clears with Any",
    async (locale) => {
      await ensureLocale(locale);
      await i18n.changeLanguage(locale);
      try {
        const copy = (key: Parameters<typeof adminMessage>[0]) =>
          adminMessage(key, locale);
        const now = Date.now();
        const state = emptyAdminState();
        state.users = [
          adminUser({ id: "verified", createdAt: now }),
          adminUser({
            id: "unverified",
            createdAt: now,
            emailVerifiedAt: null,
          }),
          adminUser({
            id: "old",
            createdAt: now - 2 * 86_400_000,
            emailVerifiedAt: null,
          }),
        ];
        const server = new FakeAdminServer(state);
        vi.stubGlobal("fetch", server.fetchImpl);
        const user = userEvent.setup();
        renderAdmin("/admin/users?period=24h");
        await screen.findByTestId("admin-user-row-verified");
        expect(screen.queryByTestId("admin-user-row-old")).toBeNull();
        expect(
          screen.getByRole("button", { name: copy("admin.filter.period.24h") }),
        ).toHaveAttribute("aria-pressed", "true");

        const trigger = () =>
          screen.getByRole("button", {
            name: new RegExp(`^${copy("admin.filters.open")}( \\d+)?$`),
          });
        const open = async () => {
          await user.click(trigger());
          const dialog = within(
            screen.getByRole("dialog", {
              name: copy("admin.filters.title.users"),
            }),
          );
          await user.click(
            dialog.getByRole("button", {
              name: copy("admin.filters.verified"),
            }),
          );
          return within(
            dialog.getByRole("radiogroup", {
              name: copy("admin.filters.verified.control"),
            }),
          );
        };
        let choices = await open();
        expect(
          choices.getByRole("radio", { name: copy("admin.filters.any") }),
        ).toHaveFocus();
        await user.keyboard("{ArrowDown}");
        expect(
          choices.getByRole("radio", {
            name: copy("admin.filters.verified.yes"),
          }),
        ).toHaveFocus();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(trigger()).toHaveFocus());
        expect(currentQuery().has("verified")).toBe(false);

        await open();
        await user.keyboard("{End}{Enter}");
        const chip = await screen.findByTestId("admin-filter-verified");
        const unverified = copy("admin.filters.verified.no");
        expect(chip).toHaveTextContent(unverified);
        expect(
          within(chip).getByRole("button", {
            name: adminMessage("admin.filters.removeUnsupported", locale, {
              facet: unverified,
            }),
          }),
        ).toBeVisible();
        expect(currentQuery().get("verified")).toBe("false");
        await waitFor(() => {
          const query = lastRequest(server, "/admin/entities/users")?.query;
          expect(query?.get("verified")).toBe("false");
          expect(Number(query?.get("from"))).toBeGreaterThan(
            now - 86_400_000 - 1000,
          );
          expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
            adminMessage("admin.filters.results", locale, { total: 1 }),
          );
        });
        expect(screen.getByTestId("admin-user-row-unverified")).toBeVisible();
        expect(screen.queryByTestId("admin-user-row-verified")).toBeNull();

        choices = await open();
        expect(
          choices.getByRole("radio", { name: unverified }),
        ).toHaveAttribute("aria-checked", "true");
        await user.keyboard("{Home}[Space]");
        await screen.findByTestId("admin-user-row-verified");
        expect(screen.queryByTestId("admin-filter-verified")).toBeNull();
        expect(currentQuery().get("period")).toBe("24h");
        expect(currentQuery().has("verified")).toBe(false);
      } finally {
        await i18n.changeLanguage("en");
      }
    },
  );

  it("filters by a second accepted admin and resolves a missing user id", async () => {
    const state = stateWithTwoBoards();
    state.users = [
      adminUser({ id: "second-admin", displayName: "Second Admin" }),
    ];
    const server = new FakeAdminServer(state);
    server.boardMembers["b-1"] = [
      boardMember({ userId: "second-admin", role: "ADMIN" }),
    ];
    server.boardMembers["b-2"] = [
      boardMember({ userId: "second-admin", role: "ADMIN", acceptedAt: null }),
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    const user = userEvent.setup();
    renderAdmin(
      "/admin/boards?tab=boards&adminMemberId=missing-user&verified=false",
    );

    const chip = await screen.findByTestId("admin-filter-adminMemberId");
    await waitFor(() =>
      expect(
        within(chip).getByRole("button", {
          name: "Remove filter: Admin member — Unknown user · missing-",
        }),
      ).toBeVisible(),
    );
    await waitFor(() => expect(currentQuery().has("verified")).toBe(false));
    const dialog = await openListFacet(
      user,
      "Filters for boards",
      "Admin member",
    );
    await user.type(dialog.getByRole("combobox"), "Second Admin");
    await user.click(
      await dialog.findByRole("option", {
        name: /Second Admin.*member@example.com/,
      }),
    );
    await screen.findByTestId("admin-board-row-b-1");
    expect(screen.queryByTestId("admin-board-row-b-2")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByTestId("admin-filter-adminMemberId"),
      ).toHaveTextContent("Second Admin"),
    );
    expect(currentQuery().get("adminMemberId")).toBe("second-admin");
    expect(
      server.requests.some(
        ({ path, query }) =>
          path === "/admin/filter-options" &&
          query.get("type") === "user" &&
          query.get("ids") === "second-admin",
      ),
    ).toBe(true);
  });

  it("keeps board scope across content tabs and filters links by either card and link type", async () => {
    const state = stateWithTwoBoards();
    state.cards.push(
      adminCard({ id: "other-card", boardId: "b-1", title: "Linked card" }),
      adminCard({
        id: "incoming-card",
        boardId: "b-1",
        title: "Incoming link",
      }),
    );
    state.cardLinks = [
      adminCardLink({
        id: "incoming",
        boardId: "b-1",
        fromCardId: "incoming-card",
        toCardId: "card-1",
        type: "blocks",
      }),
      adminCardLink({
        id: "outgoing",
        boardId: "b-1",
        fromCardId: "card-1",
        toCardId: "other-card",
        type: "relates_to",
      }),
    ];
    const server = new FakeAdminServer(state);
    vi.stubGlobal("fetch", server.fetchImpl);
    const user = userEvent.setup();
    renderAdmin(
      "/admin/boards?tab=columns&boardId=b-1&adminMemberId=second-admin",
    );

    for (const [tab, title, facets] of [
      ["columns", "columns", ["Board"]],
      ["labels", "labels", ["Board"]],
      ["checklists", "checklists", ["Board", "Card"]],
      ["links", "card links", ["Board", "Card", "Link type"]],
    ] as const) {
      await user.click(await screen.findByTestId(`admin-hub-tab-${tab}`));
      await user.click(screen.getByRole("button", { name: /^Filters/ }));
      const dialog = within(
        screen.getByRole("dialog", { name: `Filters for ${title}` }),
      );
      expect(
        dialog.getAllByRole("button").map((button) => button.textContent),
      ).toEqual([...facets, "Close"]);
      await user.keyboard("{Escape}");
      expect(currentQuery().get("boardId")).toBe("b-1");
      expect(currentQuery().has("adminMemberId")).toBe(false);
    }
    expect(screen.queryByTestId("admin-hub-tab-checklistItems")).toBeNull();

    const card = await openListFacet(user, "Filters for card links", "Card");
    await user.click(
      await card.findByRole("option", { name: /Moderate me.*card-1/ }),
    );
    const types = await openListFacet(
      user,
      "Filters for card links",
      "Link type",
    );
    await user.click(types.getByRole("checkbox", { name: "Blocks" }));
    await user.click(types.getByRole("checkbox", { name: "Relates to" }));
    await user.click(types.getByRole("button", { name: "Apply" }));
    expect(currentQuery().getAll("type")).toEqual(["blocks", "relates_to"]);
    await waitFor(() =>
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        "Results: 2",
      ),
    );
    await user.click(
      screen.getByRole("button", { name: "Remove filter: Link type — Blocks" }),
    );
    expect(currentQuery().getAll("type")).toEqual(["relates_to"]);
    await waitFor(() =>
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        "Results: 1",
      ),
    );
  });
});

describe("moderation filter bar", () => {
  it("applies a kind draft and author lookup, then preserves only the board and return link between tabs", async () => {
    const server = moderationServer();
    const user = userEvent.setup();
    renderAdmin(
      "/admin/moderation?tab=comments&boardId=b-1&cardId=card-1&period=7d&returnTo=%2Fadmin",
    );
    const title = "Filters for comments";
    expect(
      await screen.findByRole("button", { name: "7 days" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("An ordinary note")).toBeVisible();
    expect(
      lastRequest(server, "/admin/entities/comments")?.query.has("from"),
    ).toBe(true);

    let kind = await openListFacet(user, title, "Comment kind");
    await user.click(kind.getByRole("checkbox", { name: "Blocker" }));
    await user.keyboard("{Escape}");
    expect(currentQuery().has("kind")).toBe(false);

    kind = await openListFacet(user, title, "Comment kind");
    await user.click(kind.getByRole("checkbox", { name: "Blocker" }));
    await user.click(kind.getByRole("checkbox", { name: "Question" }));
    expect(currentQuery().has("kind")).toBe(false);
    await user.click(kind.getByRole("button", { name: "Apply" }));
    expect(currentQuery().getAll("kind")).toEqual(["blocker", "question"]);
    await waitFor(() =>
      expect(screen.getByTestId("admin-filter-results")).toHaveTextContent(
        "Results: 2",
      ),
    );
    const blocked = screen.getByRole("row", { name: /Blocked on review/ });
    expect(within(blocked).getByText("Blocker")).toBeVisible();

    const author = await openListFacet(user, title, "Author");
    const authorInput = author.getByRole("combobox", {
      name: "Search options — Author",
    });
    await user.type(authorInput, "member@example.com");
    await user.click(
      await author.findByRole("option", {
        name: /Alex Moderator.*member@example.com/,
      }),
    );
    expect(currentQuery().get("authorId")).toBe("u-1");
    expect(
      await screen.findByRole("button", {
        name: /Remove filter: Author.*Alex Moderator.*member@example.com/,
      }),
    ).toBeVisible();
    expect(
      lastRequest(server, "/admin/entities/comments")?.query.get("authorId"),
    ).toBe("u-1");
    expect(
      server.requests.some(
        ({ path, query }) =>
          path === "/admin/filter-options" &&
          query.get("type") === "user" &&
          query.get("q") === "member@example.com" &&
          !query.has("boardId"),
      ),
    ).toBe(true);

    await user.click(screen.getByRole("tab", { name: "Attachments" }));
    expect(await screen.findByText("Inline")).toBeVisible();
    expect(await screen.findByText("Detached")).toBeVisible();
    expect(Object.fromEntries(currentQuery())).toEqual({
      tab: "attachments",
      boardId: "b-1",
      returnTo: "/admin",
    });
    expect(screen.getByTestId("admin-filter-boardId")).toHaveTextContent(
      "Same name",
    );
    await user.click(screen.getByRole("tab", { name: "Comments" }));
    expect(await screen.findByText("An ordinary note")).toBeVisible();
    expect(Object.fromEntries(currentQuery())).toEqual({
      tab: "comments",
      boardId: "b-1",
      returnTo: "/admin",
    });
    expect(
      lastRequest(server, "/admin/entities/comments")?.query.has("kind"),
    ).toBe(false);
  });

  it("uses localized radios, chips and empty state in the Russian phone sheet", async () => {
    const server = moderationServer();
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: media === "(max-width: 639px)",
      media,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }));
    await ensureLocale("ru");
    await i18n.changeLanguage("ru");
    const user = userEvent.setup();
    const view = renderAdmin(
      "/admin/moderation?tab=attachments&boardId=b-1&period=24h",
    );
    try {
      expect(
        await screen.findByRole("button", { name: "24 часа" }),
      ).toHaveAttribute("aria-pressed", "true");
      expect(
        lastRequest(server, "/admin/entities/attachments")?.query.has("from"),
      ).toBe(true);
      const open = (facet: string) =>
        openListFacet(user, "Фильтры вложений", facet, /^Фильтры/);
      const mime = await open("Тип файла");
      expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
      const mimeGroup = mime.getByRole("radiogroup", {
        name: "Фильтр по типу файла",
      });
      expect(
        within(mimeGroup).getByRole("radio", { name: "Любой вариант" }),
      ).toHaveFocus();
      await user.keyboard("{ArrowDown}[Space]");
      expect(currentQuery().get("mime")).toBe("image");
      expect(
        await screen.findByRole("button", {
          name: "Удалить фильтр: Изображения",
        }),
      ).toBeVisible();

      let transcode = await open("Обработка видео");
      const transcodeGroup = transcode.getByRole("radiogroup", {
        name: "Фильтр по обработке видео",
      });
      await user.keyboard("{End}{Escape}");
      expect(currentQuery().has("transcode")).toBe(false);
      expect(screen.getByRole("button", { name: /^Фильтры/ })).toHaveFocus();
      transcode = await open("Обработка видео");
      await user.click(
        transcode.getByRole("radio", { name: "Обработка: ошибка" }),
      );
      expect(currentQuery().get("transcode")).toBe("failed");
      expect(
        await screen.findByRole("button", {
          name: "Удалить фильтр: Обработка: ошибка",
        }),
      ).toBeVisible();
      expect(
        await screen.findByText("Нет вложений, соответствующих этим фильтрам."),
      ).toBeVisible();
      expect(transcodeGroup).not.toBeInTheDocument();
      transcode = await open("Обработка видео");
      await user.click(transcode.getByRole("radio", { name: "Любой вариант" }));
      expect(currentQuery().has("transcode")).toBe(false);
      expect(await screen.findByText("Встроено")).toBeVisible();
      await user.click(
        screen.getByRole("button", { name: "Удалить фильтр: Изображения" }),
      );
      expect(currentQuery().has("mime")).toBe(false);

      const uploader = await open("Кто загрузил");
      await user.type(uploader.getByRole("combobox"), "Alex Moderator");
      await user.click(
        await uploader.findByRole("option", { name: /Alex Moderator/ }),
      );
      expect(currentQuery().get("uploadedById")).toBe("u-1");
      expect(screen.getByTestId("admin-filter-uploadedById")).toHaveTextContent(
        "Кто загрузил",
      );
    } finally {
      view.unmount();
      await i18n.changeLanguage("en");
    }
  });
});
