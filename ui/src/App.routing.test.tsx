import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import App from "@/App";

/**
 * BrowserRouter smoke (TASK-21.8). Deep links are plain paths now, so a
 * direct load of /board/:id (jsdom owns the URL via the History API) must
 * land on the board itself. An unknown path (or an unknown board id) shows
 * the in-app 404 instead of being silently redirected to another board.
 */
function visit(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

function boardJson(id: string, title: string) {
  return JSON.stringify({
    id,
    title,
    columns: [{ id: `${id}-col`, title: "To do", cardIds: [], createdAt: 1 }],
    cards: {},
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  });
}

describe("BrowserRouter routing", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("opens the board on a direct /board/:id deep link", async () => {
    visit("/board/board-main");
    // The seed board's first card — proof the board, not the empty
    // state, is on screen.
    expect(
      await screen.findByText(
        "Design the new onboarding flow",
        {},
        {
          timeout: 5000,
        },
      ),
    ).toBeDefined();
  });

  it("shows the not-found screen for an unknown path", async () => {
    visit("/definitely-not-a-route");
    expect(
      await screen.findByText("Page not found", {}, { timeout: 5000 }),
    ).toBeDefined();
  });

  it("resets the board filter when switching boards (B-8)", async () => {
    localStorage.setItem(
      "janosik-boards",
      `[${boardJson("b-1", "Alpha")},${boardJson("b-2", "Beta")}]`,
    );
    visit("/board/b-1");

    const filter = await screen.findByLabelText("Search cards", {
      selector: "input",
    });
    fireEvent.change(filter, { target: { value: "zzz" } });
    expect(filter).toHaveValue("zzz");

    // Switch to Beta through the header switcher (same as BoardSwitcher).
    fireEvent.click(screen.getByRole("button", { name: "Switch board" }));
    const search = await screen.findByLabelText("Search boards…");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Beta" })).toBeInTheDocument();
    });
    // The filter did not survive the board switch.
    expect(
      screen.getByLabelText("Search cards", { selector: "input" }),
    ).toHaveValue("");
  });
});
