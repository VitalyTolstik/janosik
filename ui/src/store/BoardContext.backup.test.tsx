import { act, render } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import { BoardProvider, useBoardActions } from "@/store/BoardContext";
import type { BoardState } from "@janosik/shared";
import { createBackup } from "@/utils/backup";

vi.mock("@/utils/backup", () => ({
  createBackup: vi.fn().mockResolvedValue(undefined),
}));

/**
 * The auto-backup throttle (TASK-21.4). It used to be leading-only, so
 * everything edited inside the 60 s window after a snapshot never reached a
 * backup at all — the window simply expired unnoticed. It now also fires a
 * trailing snapshot with the latest state.
 */

const backupMock = vi.mocked(createBackup);

function seedBoard() {
  localStorage.setItem(
    "janosik-boards",
    JSON.stringify([
      {
        id: "b-1",
        title: "Alpha",
        columns: [
          { id: "col-1", title: "To do", cardIds: ["c-1"], createdAt: 1 },
        ],
        cards: {
          "c-1": {
            id: "c-1",
            title: "First card",
            labelIds: [],
            createdAt: 1000,
            updatedAt: 1000,
          },
        },
        labels: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ]),
  );
}

let api: ReturnType<typeof useBoardActions>;

function Probe() {
  api = useBoardActions();
  return null;
}

function lastSnapshot(): BoardState {
  const call = backupMock.mock.calls.at(-1);
  if (!call) throw new Error("no backup was created");
  return call[0];
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <MemoryRouter initialEntries={[routes.board("b-1")]}>
            <BoardProvider>
              <Routes>
                <Route path={routes.boardPattern} element={<Probe />} />
              </Routes>
            </BoardProvider>
          </MemoryRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

describe("auto-backup throttle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    seedBoard();
    backupMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("snapshots the leading change and then the trailing one", () => {
    renderProvider();

    // Mount is the leading edge of the window.
    expect(backupMock).toHaveBeenCalledTimes(1);

    // Edits inside the window coalesce — still one snapshot so far.
    act(() => api.updateCard("c-1", { title: "One" }));
    act(() => vi.advanceTimersByTime(30_000));
    act(() => api.updateCard("c-1", { title: "Two" }));
    expect(backupMock).toHaveBeenCalledTimes(1);

    // ...and land in a single trailing snapshot when the window closes.
    act(() => vi.advanceTimersByTime(30_000));
    expect(backupMock).toHaveBeenCalledTimes(2);
    expect(lastSnapshot()[0]?.cards["c-1"]?.title).toBe("Two");

    // A quiet window schedules nothing.
    act(() => vi.advanceTimersByTime(120_000));
    expect(backupMock).toHaveBeenCalledTimes(2);
  });

  it("takes a snapshot the window was still holding along on unmount", () => {
    const { unmount } = renderProvider();
    expect(backupMock).toHaveBeenCalledTimes(1);

    act(() => api.updateCard("c-1", { title: "Edited" }));
    expect(backupMock).toHaveBeenCalledTimes(1);

    unmount();
    expect(backupMock).toHaveBeenCalledTimes(2);
    expect(lastSnapshot()[0]?.cards["c-1"]?.title).toBe("Edited");
  });
});
