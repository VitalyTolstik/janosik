import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
let publicSharesEnabled = true;
let patchFailure = false;
const requests: Array<{ method: string; path: string; body: unknown }> = [];

function router(input: RequestInfo | URL, init?: RequestInit): Response {
  const url = new URL(String(input), "http://api.test");
  const method = init?.method ?? "GET";
  const path = url.pathname.replace("/api/v1", "");
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  requests.push({ method, path, body });

  if (path === "/auth/config" && method === "GET") {
    return json({
      allowRegistration: true,
      allowPublicShares: publicSharesEnabled,
      limits: { boards: null, importBytes: 25 * 1024 * 1024 },
    });
  }
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
  if (revoke && method === "PATCH") {
    if (patchFailure) return json({ message: "boom" }, 500);
    const id = revoke[1] ?? "";
    const patch = body as Record<string, unknown>;
    shares = shares.map((s) =>
      s.id === id
        ? {
            ...s,
            ...(patch.title !== undefined
              ? { title: patch.title as string | null }
              : {}),
            ...(typeof patch.includeComments === "boolean"
              ? { includeComments: patch.includeComments }
              : {}),
            ...(typeof patch.includeAttachments === "boolean"
              ? { includeAttachments: patch.includeAttachments }
              : {}),
            ...(patch.expiresAt !== undefined
              ? {
                  expiresAt:
                    patch.expiresAt === null
                      ? null
                      : Date.parse(String(patch.expiresAt)),
                }
              : {}),
          }
        : s,
    );
    return json(shares.find((s) => s.id === id));
  }
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
  publicSharesEnabled = true;
  patchFailure = false;
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
  it("hides the entry point when the operator disabled public shares (M4)", async () => {
    publicSharesEnabled = false;
    renderDialog();
    await waitFor(() =>
      expect(screen.queryByTestId("share-trigger")).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId("share-trigger")).toBeNull();
  });

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
  it("defaults snapshot comments to off on mode change and explains what is captured", async () => {
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    const comments = await screen.findByRole("checkbox", {
      name: "Show comments",
    });
    expect(comments).toBeChecked();
    fireEvent.click(screen.getByTestId("share-mode-snapshot"));
    expect(comments).not.toBeChecked();
    expect(
      screen.getByText(/comments are off by default/i),
    ).toBeInTheDocument();
    fireEvent.click(comments);
    expect(comments).toBeChecked();
    fireEvent.click(screen.getByTestId("share-mode-live"));
    fireEvent.click(screen.getByTestId("share-mode-snapshot"));
    expect(comments).not.toBeChecked();
  });

  it("shows when enabled snapshot content still needs a refresh", async () => {
    shares = [share({ mode: "snapshot", effectiveIncludeComments: false })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByTestId("share-mode-snapshot"));
    expect(
      await screen.findByText(/refresh the snapshot to publish/i),
    ).toBeInTheDocument();
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

  it("edits a link through PATCH and keeps mode and token immutable", async () => {
    shares = [share({ title: "Old label", expiresAt: Date.now() + 3_600_000 })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit link/ }));

    expect(screen.getByText("Edit link")).toBeInTheDocument();
    expect(
      screen.getByText("Mode and token can't be changed"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("share-mode-live")).toBeNull();
    expect(screen.queryByTestId("share-mode-snapshot")).toBeNull();
    const titleInput = screen.getByRole("textbox", {
      name: "Label (optional, for your list)",
    });
    expect(titleInput).toHaveFocus();

    fireEvent.change(titleInput, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show comments" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show attachments" }));
    fireEvent.click(screen.getByTestId("share-save"));

    expect(
      await screen.findByText("Change what this live link shows?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change visibility" }));

    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
        ),
      ).toBe(true),
    );
    const patch = requests.find(
      (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
    );
    expect(patch?.body).toEqual({
      title: "Renamed",
      includeComments: false,
      includeAttachments: true,
    });
    expect(patch?.body).not.toHaveProperty("mode");
    expect(patch?.body).not.toHaveProperty("token");
    // An untouched expiry is omitted, not re-based on save.
    expect(patch?.body).not.toHaveProperty("expiresAt");

    await waitFor(() =>
      expect(screen.getByTestId("share-row")).toHaveTextContent("Renamed"),
    );
    expect(screen.getByTestId("share-mode-live")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Edit link Renamed (tok1)" }),
      ).toHaveFocus(),
    );
  });

  it("cancels editing without a request and returns focus", async () => {
    shares = [share({ title: "Old label" })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    const editButton = await screen.findByRole("button", {
      name: /^Edit link/,
    });
    fireEvent.click(editButton);
    const input = screen.getByRole("textbox", {
      name: "Label (optional, for your list)",
    });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Discarded" } });
    expect(input).toHaveValue("Discarded");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(editButton).toHaveFocus());
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(screen.queryByText("Edit link")).toBeNull();
    expect(
      screen.getByRole("textbox", {
        name: "Label (optional, for your list)",
      }),
    ).toHaveValue("");
    expect(screen.getByText("Old label")).toBeInTheDocument();
  });

  it("confirms before changing privacy flags on an active live link", async () => {
    shares = [share({ includeComments: true, includeAttachments: false })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit link/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show comments" }));
    fireEvent.click(screen.getByTestId("share-save"));

    const dialog = await screen.findByRole("dialog", {
      name: "Change what this live link shows?",
    });
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(
      screen.getByRole("checkbox", { name: "Show comments" }),
    ).not.toBeChecked();

    fireEvent.click(screen.getByTestId("share-save"));
    const again = await screen.findByRole("dialog", {
      name: "Change what this live link shows?",
    });
    fireEvent.click(
      within(again).getByRole("button", { name: "Change visibility" }),
    );
    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
        ),
      ).toBe(true),
    );
  });

  it("clears a link's expiry", async () => {
    shares = [share({ title: "Expiring", expiresAt: Date.now() + 3_600_000 })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit link/ }));

    const ttl = screen.getByTestId("share-ttl");
    expect(ttl).toHaveTextContent("Keep current expiry");
    fireEvent.click(ttl);
    fireEvent.click(await screen.findByRole("radio", { name: "Never" }));
    fireEvent.click(screen.getByTestId("share-save"));

    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
        ),
      ).toBe(true),
    );
    const patch = requests.find(
      (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
    );
    expect(patch?.body).toEqual({
      title: "Expiring",
      includeComments: true,
      includeAttachments: false,
      expiresAt: null,
    });
    await waitFor(() =>
      expect(screen.getByTestId("share-row")).toHaveTextContent("No expiry"),
    );
  });

  it("keeps an update failure visible in the form", async () => {
    patchFailure = true;
    shares = [share({ title: "Old label" })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit link/ }));
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Label (optional, for your list)",
      }),
      { target: { value: "Still here" } },
    );
    fireEvent.click(screen.getByTestId("share-save"));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save the link — your changes are still here",
    );
    expect(
      screen.getByRole("textbox", {
        name: "Label (optional, for your list)",
      }),
    ).toHaveValue("Still here");
    expect(screen.getByText("Edit link")).toBeInTheDocument();
  });

  it("does not confirm a snapshot's flag change", async () => {
    shares = [
      share({ mode: "snapshot", includeComments: false, expiresAt: null }),
    ];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByTestId("share-mode-snapshot"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit link/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Show comments" }));
    fireEvent.click(screen.getByTestId("share-save"));

    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
        ),
      ).toBe(true),
    );
    expect(
      screen.queryByText("Change what this live link shows?"),
    ).not.toBeInTheDocument();
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch?.body).toMatchObject({ includeComments: true });
  });

  it("omits expiresAt when the picker returns to Keep current expiry", async () => {
    shares = [share({ expiresAt: Date.now() + 3_600_000 })];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit link/ }));

    fireEvent.click(screen.getByTestId("share-ttl"));
    fireEvent.click(await screen.findByRole("radio", { name: "1 h" }));
    expect(screen.getByTestId("share-ttl")).toHaveTextContent("1 h");
    fireEvent.click(screen.getByTestId("share-ttl"));
    fireEvent.click(
      await screen.findByRole("radio", { name: "Keep current expiry" }),
    );
    fireEvent.click(screen.getByTestId("share-save"));

    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
        ),
      ).toBe(true),
    );
    const patch = requests.find(
      (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
    );
    expect(patch?.body).not.toHaveProperty("expiresAt");
  });

  it("starts the snapshot create form with comments off after edit and cancel", async () => {
    shares = [
      share({ mode: "snapshot", includeComments: false, expiresAt: null }),
    ];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByTestId("share-mode-snapshot"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit link/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByTestId("share-mode-snapshot")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("checkbox", { name: "Show comments" }),
    ).not.toBeChecked();
  });

  it("gives every row's Edit button a distinct accessible name", async () => {
    shares = [
      share({ id: "sh1", token: "tok1", title: "Alpha" }),
      share({ id: "sh2", token: "tok2", title: "Beta" }),
      share({ id: "sh3", token: "tok3", title: null }),
    ];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));

    expect(
      await screen.findByRole("button", { name: "Edit link Alpha (tok1)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit link Beta (tok2)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Edit link tok3" }),
    ).toBeInTheDocument();
  });

  it("clears a snapshot link's expiry", async () => {
    shares = [
      share({
        mode: "snapshot",
        title: "Snapshot",
        includeComments: false,
        expiresAt: Date.now() + 3_600_000,
      }),
    ];
    renderDialog();
    fireEvent.click(await screen.findByTestId("share-trigger"));
    fireEvent.click(await screen.findByTestId("share-mode-snapshot"));
    fireEvent.click(await screen.findByRole("button", { name: /^Edit link/ }));
    fireEvent.click(screen.getByTestId("share-ttl"));
    fireEvent.click(await screen.findByRole("radio", { name: "Never" }));
    fireEvent.click(screen.getByTestId("share-save"));

    await waitFor(() =>
      expect(
        requests.some(
          (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
        ),
      ).toBe(true),
    );
    const patch = requests.find(
      (r) => r.method === "PATCH" && r.path === "/boards/b1/shares/sh1",
    );
    expect(patch?.body).toMatchObject({ expiresAt: null });
    await waitFor(() =>
      expect(screen.getByTestId("share-row")).toHaveTextContent("No expiry"),
    );
  });
});
