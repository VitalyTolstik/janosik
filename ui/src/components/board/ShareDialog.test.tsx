import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  const permanent = path.match(/^\/boards\/b1\/shares\/([^/]+)\/permanent$/);
  if (permanent && method === "DELETE") {
    shares = shares.filter((s) => s.id !== permanent[1]);
    return new Response(null, { status: 204 });
  }
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
  it("shows a busy list skeleton while the links load", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input), "http://api.test");
        if (
          url.pathname === "/api/v1/boards/b1/shares" &&
          (init?.method ?? "GET") === "GET"
        ) {
          await gate;
        }
        return router(input, init);
      },
    );

    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));

    const skeleton = await screen.findByTestId("share-list-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");

    act(() => release());

    expect(await screen.findByText("No links yet")).toBeInTheDocument();
    expect(screen.queryByTestId("share-list-skeleton")).toBeNull();
  });

  it("does not offer copying an expired link", async () => {
    shares = [share({ expiresAt: Date.now() - 1000 })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    expect(await screen.findByText("Expired")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Copy link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Embed code" }),
    ).not.toBeInTheDocument();
  });
  it("shows only links of the selected mode", async () => {
    shares = [
      share({ id: "live", token: "live-token", mode: "live" }),
      share({
        id: "snap",
        token: "snapshot-token",
        mode: "snapshot",
        revokedAt: 1,
      }),
    ];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    expect(await screen.findByText("/s/live-token")).toBeInTheDocument();
    expect(screen.queryByText("/s/snapshot-token")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("share-mode-snapshot"));
    expect(screen.getByText("/s/snapshot-token")).toBeInTheDocument();
    expect(screen.queryByText("/s/live-token")).not.toBeInTheDocument();
    expect(screen.getByTestId("share-mode-snapshot")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
  it("confirms before removing a revoked link", async () => {
    shares = [share({ revokedAt: 1 })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Delete revoked link" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel deletion" }));
    expect(requests.some((r) => r.path.endsWith("/permanent"))).toBe(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Delete revoked link" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm deletion" }));
    await waitFor(() =>
      expect(screen.queryByTestId("share-row")).not.toBeInTheDocument(),
    );
    expect(
      requests.some(
        (r) => r.method === "DELETE" && r.path.endsWith("/permanent"),
      ),
    ).toBe(true);
  });

  it("shows the active limit and warns about a similar link", async () => {
    shares = Array.from({ length: 5 }, (_, i) =>
      share({
        id: `s${i}`,
        token: `t${i}`,
        createdAt: Date.now(),
        expiresAt: Date.now() + 24 * 3_600_000,
      }),
    );
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    expect(await screen.findByText("Active links: 5 / 5")).toBeInTheDocument();
    expect(
      screen.getByText(/A link with similar settings already exists/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("share-create")).toBeDisabled();
  });
  it("copies embed code with the selected theme", async () => {
    shares = [share()];
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByText("Embed code"));
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy embed code" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        expect.stringContaining("/s/tok1?embed=1&theme=light"),
      ),
    );
  });
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

  it("changes the link lifetime from the themed picker", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    const trigger = await screen.findByTestId("share-ttl");
    expect(trigger).toHaveTextContent("24 h");
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("radio", { name: "1 h" }));
    expect(screen.getByTestId("share-ttl")).toHaveTextContent("1 h");
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
    expect(
      screen.queryByRole("button", { name: "Copy link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Embed code" }),
    ).not.toBeInTheDocument();
  });
});
