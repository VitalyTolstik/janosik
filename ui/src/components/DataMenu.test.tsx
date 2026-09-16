import "fake-indexeddb/auto";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DataMenu } from "@/components/DataMenu";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import { BoardProvider } from "@/store/BoardContext";
import type { BoardState } from "@janosik/shared";
import { createBackup } from "@/utils/backup";

/**
 * Smoke tests for the data menu (T-8): a manual "save a copy now", and the
 * route into the backups browser where a snapshot is restored.
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

async function resetDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("janosik-backups");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

function renderMenu() {
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
                        element={<DataMenu />}
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

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Data & backups" }));
}

describe("DataMenu", () => {
  beforeEach(async () => {
    await resetDb();
    localStorage.clear();
    localStorage.setItem("janosik-boards", JSON.stringify(boardState()));
  });

  afterEach(async () => {
    await resetDb();
  });

  it("saves a manual backup copy from the menu", async () => {
    renderMenu();
    await openMenu();

    await userEvent.click(await screen.findByText("Save a copy now"));

    await waitFor(() =>
      expect(screen.getByText("Backup saved")).toBeInTheDocument(),
    );
  });

  it("opens the backups browser and restores a snapshot", async () => {
    await createBackup(boardState());
    renderMenu();
    await openMenu();

    await userEvent.click(await screen.findByTestId("data-backups"));

    expect(await screen.findAllByTestId("backup-row")).not.toHaveLength(0);
    // The provider's mount auto-backup may add rows too — restore any one.
    const [restore] = await screen.findAllByRole("button", {
      name: "Restore",
    });
    await userEvent.click(restore);
    await userEvent.click(
      await screen.findByRole("button", { name: "Yes, restore" }),
    );

    await waitFor(() =>
      expect(screen.getByText("Backup restored")).toBeInTheDocument(),
    );
  });
});
