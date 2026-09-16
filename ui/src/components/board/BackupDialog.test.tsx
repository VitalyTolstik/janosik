import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BackupDialog } from "@/components/board/BackupDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import { BoardProvider } from "@/store/BoardContext";
import type { BoardState } from "@janosik/shared";

// The provider's auto-backup on mount would race the seeded snapshots in the
// list; keep the real read/load/delete, stub only the writes.
vi.mock("@/utils/backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/backup")>();
  return { ...actual, createBackup: vi.fn().mockResolvedValue(undefined) };
});

/**
 * Smoke tests for the automatic-backups browser (T-8): it lists stored
 * snapshots, restores one after the inline confirmation, and deletes one.
 * `fake-indexeddb/auto` supplies an in-memory IndexedDB.
 */

function boardState(): BoardState {
  return [
    {
      id: "b-1",
      title: "Alpha",
      columns: [{ id: "col-1", title: "To do", cardIds: [], createdAt: 1 }],
      cards: {},
      labels: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
}

async function seedBackup(state: BoardState) {
  const actual =
    await vi.importActual<typeof import("@/utils/backup")>("@/utils/backup");
  await actual.createBackup(state);
}

async function resetDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("janosik-backups");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function renderDialog() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <ToastProvider>
              <TooltipProvider>
                <MemoryRouter initialEntries={[routes.board("b-1")]}>
                  <BoardProvider>
                    <Routes>
                      <Route
                        path={routes.boardPattern}
                        element={<BackupDialog open onOpenChange={() => {}} />}
                      />
                    </Routes>
                  </BoardProvider>
                </MemoryRouter>
              </TooltipProvider>
            </ToastProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

describe("BackupDialog", () => {
  beforeEach(async () => {
    await resetDb();
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify(boardState()));
  });

  afterEach(async () => {
    await resetDb();
  });

  it("shows the empty state when there are no snapshots", async () => {
    renderDialog();
    expect(
      (await screen.findAllByText(/No backups yet/)).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByTestId("backup-row")).not.toBeInTheDocument();
  });

  it("lists a snapshot and restores it after confirm", async () => {
    await seedBackup(boardState());
    renderDialog();

    expect(await screen.findAllByTestId("backup-row")).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Restore" }));
    expect(
      await screen.findByText("Replace current boards?"),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Yes, restore" }));

    await waitFor(() =>
      expect(screen.getByText("Backup restored")).toBeInTheDocument(),
    );
  });

  it("deletes a snapshot", async () => {
    await seedBackup(boardState());
    renderDialog();
    await screen.findAllByTestId("backup-row");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(screen.queryByTestId("backup-row")).not.toBeInTheDocument(),
    );
  });
});
