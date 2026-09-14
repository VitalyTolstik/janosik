import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataSafetyBanner } from "@/components/DataSafetyBanner";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import { BoardProvider, useBoardActions } from "@/store/BoardContext";
import type { BoardState } from "@/store/board-reducer";

/**
 * Data-safety banner (TASK-21.2). The ways stored data can be lost
 * silently, and the guarantee for each:
 *
 * - the write fails (quota / private mode) → a banner that does not go away
 *   on its own, offering a downloadable backup;
 * - the stored JSON is unparsable → the raw text is quarantined under
 *   `janosik-boards.corrupt.<ts>` before the seed board is written over it;
 * - the quarantine copy itself fails → writes are held back entirely, so
 *   the unparsable text survives until the user dismisses the banner.
 *
 * Plus the softer sibling from TASK-21.5: a write that succeeds but lands
 * past 80% of the assumed quota raises a dismissible warning ahead of the
 * failure.
 */

const BOARDS_KEY = "janosik-boards";
const CORRUPT = "{not json";

function corruptKeys(): string[] {
  return Object.keys(localStorage).filter((key) =>
    key.startsWith(`${BOARDS_KEY}.corrupt.`),
  );
}

/** Fail `setItem` for the keys matching `shouldFail`, pass the rest through. */
function failWritesFor(shouldFail: (key: string) => boolean) {
  const real = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key: string,
    value: string,
  ) {
    if (shouldFail(key)) throw new Error("QuotaExceededError");
    real.call(this, key, value);
  });
}

function renderBanner(children?: ReactNode) {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[routes.board("b-1")]}>
              <BoardProvider>
                <Routes>
                  <Route
                    path={routes.boardPattern}
                    element={<DataSafetyBanner />}
                  />
                  <Route path="*" element={<DataSafetyBanner />} />
                </Routes>
                {children}
              </BoardProvider>
            </MemoryRouter>
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("DataSafetyBanner", () => {
  it("stays hidden while data is being saved normally", async () => {
    renderBanner();
    await waitFor(() =>
      expect(localStorage.getItem(BOARDS_KEY)).not.toBeNull(),
    );
    expect(screen.queryByTestId("data-safety-banner")).not.toBeInTheDocument();
  });

  it("warns that data is not being saved when the write fails", async () => {
    failWritesFor((key) => key === BOARDS_KEY);
    renderBanner();

    const banner = await screen.findByTestId("data-safety-banner", undefined, {
      timeout: 3000,
    });
    expect(banner).toHaveTextContent("Data is not being saved");
    expect(banner).toHaveTextContent("Download a backup");
    // Not dismissible — it must survive until a write actually succeeds.
    expect(
      screen.queryByRole("button", { name: "Dismiss" }),
    ).not.toBeInTheDocument();
  });

  it("quarantines unparsable data and offers to restore a copy", async () => {
    localStorage.setItem(BOARDS_KEY, CORRUPT);
    renderBanner();

    const banner = await screen.findByTestId("data-safety-banner");
    expect(banner).toHaveTextContent("Saved data was damaged");
    expect(banner).toHaveTextContent("Restore from a copy");

    // The raw text was copied aside before the seed board was written.
    const quarantined = corruptKeys();
    expect(quarantined).toHaveLength(1);
    expect(localStorage.getItem(quarantined[0]!)).toBe(CORRUPT);

    // The toast names what happened once; the banner carries the actions.
    expect(
      await screen.findByText(/A copy of it was set aside/),
    ).toBeInTheDocument();

    // The seed board takes over the main key — the copy stays untouched.
    await waitFor(() =>
      expect(localStorage.getItem(BOARDS_KEY)).not.toBe(CORRUPT),
    );
    expect(localStorage.getItem(quarantined[0]!)).toBe(CORRUPT);
  });

  it("treats valid JSON of the wrong shape as damaged data too", async () => {
    // Parses fine, but it is not a board array — replacing it with the seed
    // would be exactly as silent a loss as unparsable text.
    localStorage.setItem(BOARDS_KEY, '{"boards":[]}');
    renderBanner();

    expect(await screen.findByTestId("data-safety-banner")).toHaveTextContent(
      "Saved data was damaged",
    );
    const quarantined = corruptKeys();
    expect(quarantined).toHaveLength(1);
    expect(localStorage.getItem(quarantined[0]!)).toBe('{"boards":[]}');
  });

  it("dismissing the damaged-data warning hides it", async () => {
    localStorage.setItem(BOARDS_KEY, CORRUPT);
    renderBanner();

    await screen.findByTestId("data-safety-banner");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("data-safety-banner")).not.toBeInTheDocument();
  });

  it("holds back writes when the damaged data could not be copied aside", async () => {
    localStorage.setItem(BOARDS_KEY, CORRUPT);
    failWritesFor((key) => key.startsWith(`${BOARDS_KEY}.corrupt.`));
    renderBanner();

    const banner = await screen.findByTestId("data-safety-banner");
    expect(banner).toHaveTextContent("Saved data was damaged");
    expect(corruptKeys()).toHaveLength(0);

    // Nothing was written over the user's only copy, debounce window
    // (400 ms) and auto-flush included.
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(localStorage.getItem(BOARDS_KEY)).toBe(CORRUPT);

    // Acknowledging the warning releases the held-back write.
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() =>
      expect(localStorage.getItem(BOARDS_KEY)).not.toBe(CORRUPT),
    );
  });
});

/**
 * TASK-21.5: a write that succeeds but lands past 80% of the assumed
 * localStorage quota raises the quota-warning banner. The seed crosses the
 * 4 MiB threshold honestly: ~450 cards with 10000-character descriptions
 * (the `LIMITS.description` maximum) serialize to ~4.5 MB.
 */
function bigWorkspace(): BoardState {
  const columns: BoardState[number]["columns"] = [0, 1, 2].map((c) => ({
    id: `col-${c}`,
    title: `Column ${c}`,
    cardIds: [],
    createdAt: 0,
  }));
  const cards: BoardState[number]["cards"] = {};
  for (let i = 0; i < 450; i += 1) {
    const id = `card-${i}`;
    cards[id] = {
      id,
      title: "Card",
      description: "x".repeat(10000),
      labelIds: [],
      createdAt: 0,
      updatedAt: 0,
    };
    columns[i % 3]!.cardIds.push(id);
  }
  return [
    {
      id: "b-1",
      title: "Heavy board",
      columns,
      cards,
      labels: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ];
}

function smallWorkspace(): BoardState {
  return [
    {
      id: "b-1",
      title: "Light board",
      columns: [
        { id: "col-0", title: "Column", cardIds: ["card-0"], createdAt: 0 },
      ],
      cards: {
        "card-0": {
          id: "card-0",
          title: "Card",
          labelIds: [],
          createdAt: 0,
          updatedAt: 0,
        },
      },
      labels: [],
      createdAt: 0,
      updatedAt: 0,
    },
  ];
}

function ImportTriggers() {
  const { importBoards } = useBoardActions();
  return (
    <>
      <button type="button" onClick={() => importBoards(bigWorkspace())}>
        import big
      </button>
      <button type="button" onClick={() => importBoards(smallWorkspace())}>
        import small
      </button>
    </>
  );
}

describe("DataSafetyBanner quota warning", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("warns ahead of the quota while saving still works", async () => {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(bigWorkspace()));
    renderBanner(<ImportTriggers />);

    const banner = await screen.findByTestId("data-safety-banner", undefined, {
      timeout: 3000,
    });
    expect(banner).toHaveTextContent("Storage is almost full");
    expect(banner).toHaveTextContent("Download a backup");
    // It is a heads-up, not an emergency — the user may close it.
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("clears on its own once the data shrinks under the threshold", async () => {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(bigWorkspace()));
    renderBanner(<ImportTriggers />);
    await screen.findByTestId("data-safety-banner", undefined, {
      timeout: 3000,
    });

    await userEvent.click(screen.getByRole("button", { name: "import small" }));
    await waitFor(() =>
      expect(
        screen.queryByTestId("data-safety-banner"),
      ).not.toBeInTheDocument(),
    );
  });

  it("stays quiet after dismissal until the data drops under the threshold", async () => {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(bigWorkspace()));
    renderBanner(<ImportTriggers />);
    await screen.findByTestId("data-safety-banner", undefined, {
      timeout: 3000,
    });
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("data-safety-banner")).not.toBeInTheDocument();

    // A fresh over-quota write must not bring the banner back — otherwise
    // it re-appears on every debounced save and nothing but deleting
    // boards silences it.
    await userEvent.click(screen.getByRole("button", { name: "import big" }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(screen.queryByTestId("data-safety-banner")).not.toBeInTheDocument();

    // Once the data has been under the threshold in between, a new
    // over-quota write warns again.
    await userEvent.click(screen.getByRole("button", { name: "import small" }));
    await new Promise((resolve) => setTimeout(resolve, 700));
    await userEvent.click(screen.getByRole("button", { name: "import big" }));
    expect(
      await screen.findByTestId("data-safety-banner", undefined, {
        timeout: 3000,
      }),
    ).toHaveTextContent("Storage is almost full");
  });
});
