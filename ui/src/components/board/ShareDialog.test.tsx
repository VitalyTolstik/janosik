import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Board, BoardShareDto } from "@janosik/shared";
import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { BoardBackgroundProvider } from "@/hooks/use-board-background";
import { BoardGlassProvider } from "@/hooks/use-board-glass";
import { BoardProvider } from "@/store/BoardContext";
import { ShareDialog } from "./ShareDialog";

/**
 * The owner's "Share" dialog (TASK-58) against a stubbed board API: create
 * mints a link (and copies it), the list shows the token, and revoke flips
 * the row. `BoardProvider` is mounted in server mode so `roleOf` reports the
 * caller as ADMIN — the gate that reveals the dialog.
 */

const BOARD: Board = {
  id: "b1",
  title: "Share me",
  columns: [],
  cards: {},
  labels: [],
  createdAt: 1,
  updatedAt: 1,
};

function share(overrides: Partial<BoardShareDto> = {}): BoardShareDto {
  return {
    id: "sh1",
    token: "tok1",
    boardId: "b1",
    boardTitle: "Share me",
    mode: "live",
    title: null,
    includeComments: true,
    includeAttachments: false,
    expiresAt: null,
    revokedAt: null,
    views: 0,
    lastViewedAt: null,
    createdAt: 1,
    createdBy: "u1",
    ...overrides,
  };
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function openStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({ start() {} });
}

let shares: BoardShareDto[];
const requests: Array<{ method: string; path: string; body: unknown }> = [];

function router(input: RequestInfo | URL, init?: RequestInit): Response {
  const url = new URL(String(input), "http://api.test");
  const method = init?.method ?? "GET";
  const path = url.pathname.replace("/api/v1", "");
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ method, path, body });

  if (path === "/boards" && method === "GET") {
    return json([
      {
        id: "b1",
        title: "Share me",
        counters: { cards: 0, columns: 0 },
        role: "ADMIN",
      },
    ]);
  }
  if (path === "/boards/b1" && method === "GET") {
    return json(BOARD, 200, { "X-Board-Seq": "0" });
  }
  if (path === "/boards/b1/events") return new Response(openStream());
  if (path === "/boards/b1/members") return json([]);
  if (path === "/boards/b1/shares" && method === "GET") return json(shares);
  if (path === "/boards/b1/shares" && method === "POST") {
    const created = share({
      id: "sh-new",
      token: "newtok",
      mode: (body as { mode: BoardShareDto["mode"] }).mode,
    });
    shares = [created, ...shares];
    return json(created, 201);
  }
  const revoke = path.match(/^\/boards\/b1\/shares\/([^/]+)$/);
  if (revoke && method === "DELETE") {
    const id = revoke[1] ?? "";
    shares = shares.map((s) => (s.id === id ? { ...s, revokedAt: 1 } : s));
    return json(share({ id, revokedAt: 1 }));
  }
  return json({ message: "not found" }, 404);
}

function renderDialog() {
  return render(
    <ThemeProvider>
      <BoardBackgroundProvider>
        <BoardGlassProvider>
          <I18nProvider>
            <TooltipProvider>
              <ToastProvider>
                <MemoryRouter initialEntries={["/board/b1"]}>
                  <BoardProvider>
                    <ShareDialog />
                  </BoardProvider>
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
  shares = [];
  requests.length = 0;
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(router(input, init)),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("ShareDialog", () => {
  it("creates a link, copies it and lists it", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByTestId("share-create"));

    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            r.path === "/boards/b1/shares" &&
            r.method === "POST" &&
            (r.body as { mode?: string }).mode === "live",
        ),
      ).toBe(true),
    );
    const row = await screen.findByTestId("share-row");
    expect(row).toHaveTextContent("/s/newtok");
  });

  it("revokes a link", async () => {
    shares = [share()];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    const revoke = await screen.findByText("Revoke");
    fireEvent.click(revoke);

    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "DELETE" && r.path === "/boards/b1/shares/sh1",
        ),
      ).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByTestId("share-row")).toHaveTextContent(/revoked/i),
    );
  });
});
