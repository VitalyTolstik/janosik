import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Board, PublicBoardDto } from "@janosik/shared";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { PublicBoardPage } from "./PublicBoardPage";

/**
 * Public read-only board page (TASK-58). The page runs with no session and
 * talks to `/share/:token` directly, so every test stubs `fetch` and mounts
 * it as a route outside any auth provider — the exact production shape.
 */

function snapshotBoard(): Board {
  return {
    id: "b1",
    title: "Shared board",
    columns: [{ id: "c1", title: "Todo", cardIds: ["k1"], createdAt: 1 }],
    cards: {
      k1: {
        id: "k1",
        title: "Read me",
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

function dto(overrides: Partial<PublicBoardDto> = {}): PublicBoardDto {
  return {
    mode: "snapshot",
    title: "Shared board",
    takenAt: 1,
    board: snapshotBoard(),
    seq: null,
    members: [
      { id: "u1", displayName: "Ann", avatarColor: "blue", avatarPath: null },
    ],
    includeComments: false,
    includeAttachments: false,
    ...overrides,
  };
}

function sseStream(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      // Stay open: a closed stream would make the client reconnect.
    },
  });
}

function renderPage(token: string, search = "") {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <ToastProvider>
                <MemoryRouter initialEntries={[`/s/${token}${search}`]}>
                  <Routes>
                    <Route path="/s/:token" element={<PublicBoardPage />} />
                  </Routes>
                </MemoryRouter>
              </ToastProvider>
            </TooltipProvider>
          </I18nProvider>
        </BoardGlassProvider>
      </BoardBackgroundProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PublicBoardPage", () => {
  it("renders a snapshot read-only, with no editing affordances", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify(dto()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const { container } = renderPage("snaptok");

    expect(await screen.findByText("Read me")).toBeInTheDocument();
    expect(container.querySelector("[data-composer-trigger]")).toBeNull();
    expect(container.querySelector("[data-add-column-trigger]")).toBeNull();
    // noindex meta is injected.
    expect(
      document.head
        .querySelector('meta[name="robots"]')
        ?.getAttribute("content"),
    ).toContain("noindex");
  });

  it("hides the chrome in embed mode", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify(dto()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderPage("snaptok", "?embed=1");
    expect(await screen.findByText("Read me")).toBeInTheDocument();
    expect(screen.queryByText(/Shared · read-only/)).toBeNull();
  });

  it("shows an unavailable notice for a missing token", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "Not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    renderPage("missing");
    expect(await screen.findByTestId("share-unavailable")).toBeInTheDocument();
  });

  it("applies a live command frame over SSE", async () => {
    const updated = snapshotBoard();
    updated.cards.k2 = {
      id: "k2",
      title: "Arrived live",
      labelIds: [],
      createdAt: 2,
      updatedAt: 2,
    };
    const frame =
      "data: " +
      JSON.stringify({
        type: "command",
        seq: 9,
        actorId: "u1",
        touches: ["card:k2"],
        action: {
          type: "ADD_CARD",
          boardId: "b1",
          at: 2,
          newCardId: "k2",
          columnId: "c1",
          title: "Arrived live",
        },
      }) +
      "\n\n";

    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response(sseStream([frame]), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(dto({ mode: "live", seq: 8 })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    renderPage("livetok");
    expect(await screen.findByText("Read me")).toBeInTheDocument();
    expect(await screen.findByText("Arrived live")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/Live · read-only/)).toBeInTheDocument(),
    );
  });

  it("refetches the payload when the stream asks for a resync", async () => {
    const fresh = snapshotBoard();
    fresh.cards.k3 = {
      id: "k3",
      title: "From the fresh payload",
      labelIds: [],
      createdAt: 3,
      updatedAt: 3,
    };
    fresh.columns[0]!.cardIds.push("k3");
    const payloads = [
      dto({ mode: "live", seq: 8 }),
      dto({ mode: "live", seq: 40, board: fresh }),
    ];
    let boardReads = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/events")) {
        return Promise.resolve(
          new Response(sseStream(['data: {"type":"resync"}\n\n']), {
            status: 200,
          }),
        );
      }
      const body = payloads[Math.min(boardReads, payloads.length - 1)];
      boardReads += 1;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    renderPage("livetok");
    expect(await screen.findByText("Read me")).toBeInTheDocument();
    // The truncated catch-up is replaced by a fresh payload — the page keeps
    // running, it does not fall into an error state.
    expect(
      await screen.findByText("From the fresh payload"),
    ).toBeInTheDocument();
    expect(boardReads).toBe(2);
    expect(screen.queryByTestId("share-unavailable")).toBeNull();
  });

  it("shows the unavailable notice once a revoked link's stream ends", async () => {
    let streams = 0;
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/events")) {
        streams += 1;
        // The server ends the open stream on revocation; the reconnect is
        // refused with the same 404 as an unknown token.
        if (streams === 1) {
          return Promise.resolve(
            new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.close();
                },
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ message: "Not found" }), {
            status: 404,
          }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify(dto({ mode: "live", seq: 8 })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    renderPage("livetok");
    expect(await screen.findByText("Read me")).toBeInTheDocument();
    // One backoff step (1 s) later the reconnect is refused for good.
    expect(
      await screen.findByTestId("share-unavailable", {}, { timeout: 3_000 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("share-unavailable-code")).toHaveTextContent(
      "404",
    );
    expect(streams).toBe(2);
  });

  it("shows the gone notice when a live link's board was deleted (410)", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/events")) {
        return Promise.resolve(new Response(null, { status: 410 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify(dto({ mode: "live", seq: 8 })), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    renderPage("livetok");
    expect(await screen.findByTestId("share-unavailable")).toBeInTheDocument();
    expect(screen.getByTestId("share-unavailable-code")).toHaveTextContent(
      "410",
    );
  });
});
