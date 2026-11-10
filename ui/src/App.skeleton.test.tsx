import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Board } from "@janosik/shared";
import App from "@/App";
import { FakeServer } from "@/test/fake-server";

/**
 * First-paint shell (SKELETON-AUDIT §4.2): while the routed board snapshot
 * is in flight the app reserves the header/filter/column layout instead of
 * showing a spinner and collapsing the page afterwards.
 */

function seedBoard(): Board {
  return {
    id: "b-1",
    title: "Board",
    columns: [{ id: "col-1", title: "Todo", cardIds: ["c-1"], createdAt: 1 }],
    cards: {
      "c-1": {
        id: "c-1",
        title: "Hello",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState({}, "", "/board/b-1");
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("App board shell", () => {
  it("shows the board skeleton until the first snapshot arrives", async () => {
    const server = new FakeServer([seedBoard()]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (url.pathname === "/api/v1/boards/b-1") await gate;
        return server.handle(input, init);
      },
    );

    render(<App />);

    const skeleton = await screen.findByTestId("board-shell-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getAllByTestId("board-skeleton-column").length,
    ).toBeGreaterThan(0);

    act(() => release());

    expect(
      await screen.findByRole("heading", { name: "Board" }, { timeout: 3000 }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByTestId("board-shell-skeleton")).toBeNull(),
    );
  });

  it("keeps the retry state instead of a skeleton after a failed hydration", async () => {
    const server = new FakeServer([seedBoard()]);
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (url.pathname === "/api/v1/boards") {
          return new Response(JSON.stringify({ message: "down" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        return server.handle(input, init);
      },
    );

    render(<App />);

    expect(
      await screen.findByTestId("sync-retry", {}, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("board-shell-skeleton")).toBeNull();
  });
});
