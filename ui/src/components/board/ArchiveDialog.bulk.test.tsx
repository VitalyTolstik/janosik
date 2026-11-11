import { useState } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Board } from "@janosik/shared";

import { api } from "@/api/client";
import { AuthProvider } from "@/auth/AuthContext";
import { ArchiveDialog } from "@/components/board/ArchiveDialog";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";
import { BoardProvider } from "@/store/BoardContext";
import { FakeServer } from "@/test/fake-server";

function archivedBoard(): Board {
  return {
    id: "b-1",
    title: "Board",
    columns: [{ id: "c-1", title: "To do", cardIds: [], createdAt: 1 }],
    cards: Object.fromEntries(
      [1, 2, 3].map((n) => [
        `card-${n}`,
        {
          id: `card-${n}`,
          title: `Card ${n}`,
          labelIds: [],
          createdAt: 1,
          updatedAt: n,
          archivedAt: n,
        },
      ]),
    ),
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function ArchiveProbe() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open archive</button>
      <ArchiveDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function renderArchive() {
  return render(
    <I18nProvider>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={["/board/b-1"]}>
            <BoardProvider>
              <ArchiveProbe />
            </BoardProvider>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </I18nProvider>,
  );
}

async function deleteAll() {
  await screen.findByText("Board · 3 cards");
  await userEvent.click(
    screen.getByRole("checkbox", { name: "Select all matching cards" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Delete selected" }),
  );
  const confirmation = screen.getByRole("dialog", {
    name: "Delete selected cards?",
  });
  await userEvent.click(
    within(confirmation).getByRole("button", { name: "Delete selected" }),
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  api.clearAccessToken();
  api.onAuthLost = null;
  localStorage.clear();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("background archive operations", () => {
  it("hides every selected card immediately and continues after the dialog is closed", async () => {
    const server = new FakeServer([archivedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderArchive();
    await screen.findByText("Board · 3 cards");
    const release = server.holdNextCommandBeforeCommit();
    await deleteAll();
    expect(screen.queryByTestId("archive-row")).toBeNull();
    expect(
      screen.getByText("Selected cards are being processed…"),
    ).toBeVisible();
    expect(Object.keys(server.boards.get("b-1")!.cards)).toHaveLength(3);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await userEvent.click(screen.getByRole("button", { name: "Open archive" }));
    expect(screen.queryByTestId("archive-row")).toBeNull();
    act(() => release());
    await waitFor(() =>
      expect(Object.keys(server.boards.get("b-1")!.cards)).toHaveLength(0),
    );
    await waitFor(() =>
      expect(screen.getByTestId("archive-list")).toHaveTextContent(
        "The archive is empty.",
      ),
    );
  });

  it("stops on failure and brings back cards that were not deleted", async () => {
    const server = new FakeServer([archivedBoard()]);
    vi.stubGlobal("fetch", server.handle);
    renderArchive();
    await screen.findByText("Board · 3 cards");
    server.failNextCommand(409, { conflict: "wip" });
    await deleteAll();
    await waitFor(() =>
      expect(screen.getAllByTestId("archive-row")).toHaveLength(3),
    );
    expect(Object.keys(server.boards.get("b-1")!.cards)).toHaveLength(3);
    expect(await screen.findByText(/The operation stopped/)).toBeVisible();
  });
});
