import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import App from "@/App";

/**
 * Empty-state smoke test (T-8): when every board is archived the home route
 * renders `NoBoardRoute`, and its CTA creates a fresh board and lands on it.
 */
describe("App empty state (NoBoardRoute)", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        {
          id: "b-arch",
          title: "Old board",
          columns: [],
          cards: {},
          labels: [],
          createdAt: 1,
          updatedAt: 1,
          archivedAt: 2,
        },
      ]),
    );
    window.history.replaceState({}, "", "/");
  });

  it("offers to create a board from the all-archived state", async () => {
    render(<App />);

    expect(
      await screen.findByText("All boards are archived."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Restore a board from the switcher in the header, or create a new one.",
      ),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId("empty-create-board"));

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/board\//));
  });
});
