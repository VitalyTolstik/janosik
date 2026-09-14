import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataSafetyBanner } from "@/components/DataSafetyBanner";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { I18nProvider } from "@/i18n";
import { routes } from "@/routes";
import { BoardProvider } from "@/store/BoardContext";

/**
 * Data-safety banner (TASK-21.2). The three ways stored data can be lost
 * silently, and the guarantee for each:
 *
 * - the write fails (quota / private mode) → a banner that does not go away
 *   on its own, offering a downloadable backup;
 * - the stored JSON is unparsable → the raw text is quarantined under
 *   `janosik-boards.corrupt.<ts>` before the seed board is written over it;
 * - the quarantine copy itself fails → writes are held back entirely, so
 *   the unparsable text survives until the user dismisses the banner.
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

function renderBanner() {
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
