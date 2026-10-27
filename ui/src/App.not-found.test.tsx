import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import App from "@/App";

/**
 * In-app 404: an unknown URL and a board id that is not in the account's list
 * render the not-found screen instead of being silently redirected to another
 * board.
 */
describe("App in-app 404", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(
      "janosik-boards",
      JSON.stringify([
        {
          id: "b-1",
          title: "My board",
          columns: [],
          cards: {},
          labels: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ]),
    );
  });

  it("shows the not-found screen for an unknown route", async () => {
    window.history.replaceState({}, "", "/nope");
    render(<App />);

    expect(await screen.findByText("Page not found")).toBeInTheDocument();
    expect(screen.getByTestId("not-found-back")).toBeInTheDocument();
  });

  it("shows the board-not-found screen for an unknown board id", async () => {
    window.history.replaceState({}, "", "/board/does-not-exist");
    render(<App />);

    expect(await screen.findByText("Board not found")).toBeInTheDocument();
  });
});
