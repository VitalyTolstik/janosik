import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import App from "@/App";

/**
 * BrowserRouter smoke (TASK-21.8). Deep links are plain paths now, so a
 * direct load of /board/:id (jsdom owns the URL via the History API) must
 * land on the board itself. Any other path acts as home: with an active
 * board present the app redirects to it — the empty state is for the
 * no-boards case, not for unknown paths.
 */
function visit(path: string) {
  window.history.pushState({}, "", path);
  return render(<App />);
}

describe("BrowserRouter routing", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("opens the board on a direct /board/:id deep link", async () => {
    visit("/board/b-1");
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

  it("redirects an unknown path to the active board", async () => {
    visit("/definitely-not-a-route");
    // Same proof as the deep link: the board is reachable from any path.
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
});
