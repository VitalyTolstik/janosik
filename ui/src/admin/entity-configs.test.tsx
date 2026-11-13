import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { I18nProvider } from "@/i18n";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/hooks/use-theme";
import { adminApi } from "./admin-client";
import AdminApp from "./AdminApp";
import {
  FakeAdminServer,
  adminBoard,
  boardMember,
  emptyAdminState,
  type FakeAdminState,
} from "./test/fake-admin-server";

/**
 * TASK-176.4 — audit targets with a detail route become links, unknown
 * targets keep a copyable id, and OPERATOR never gets a masters-page link.
 */

function renderAdmin(initialPath = "/admin/audit") {
  return render(
    <ThemeProvider>
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <MemoryRouter initialEntries={[initialPath]}>
              <Routes>
                <Route path="/admin/*" element={<AdminApp />} />
              </Routes>
            </MemoryRouter>
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </ThemeProvider>,
  );
}

function stateWithAudit(): FakeAdminState {
  const state = emptyAdminState();
  state.audit = [
    {
      id: "audit-user",
      adminId: "master-1",
      adminEmail: "master@example.com",
      action: "user.impersonated",
      targetType: "user",
      targetId: "u-9",
      targetExists: true,
      details: null,
      createdAt: 1_760_000_000_000,
    },
    {
      id: "audit-board",
      adminId: "master-1",
      adminEmail: "master@example.com",
      action: "board.archive",
      targetType: "board",
      targetId: "b-9",
      targetExists: true,
      details: null,
      createdAt: 1_759_999_000_000,
    },
    {
      id: "audit-card",
      adminId: "master-1",
      adminEmail: "master@example.com",
      action: "card.delete",
      targetType: "card",
      targetId: "c-9",
      targetExists: true,
      details: null,
      createdAt: 1_759_998_000_000,
    },
    {
      id: "audit-comment",
      adminId: "master-1",
      adminEmail: "master@example.com",
      action: "comment.delete",
      targetType: "comment",
      targetId: "comment-9",
      targetExists: null,
      details: null,
      createdAt: 1_759_997_000_000,
    },
    {
      id: "audit-deleted-user",
      adminId: "master-1",
      adminEmail: "master@example.com",
      action: "user.delete",
      targetType: "user",
      targetId: "u-gone",
      targetExists: false,
      details: null,
      createdAt: 1_759_996_500_000,
    },
    {
      id: "audit-none",
      adminId: "master-1",
      adminEmail: "master@example.com",
      action: "admin.login",
      targetType: null,
      targetId: null,
      targetExists: null,
      details: null,
      createdAt: 1_759_996_000_000,
    },
  ];
  return state;
}

function rowFor(action: string): HTMLElement {
  const row = screen.getByText(action).closest("tr");
  if (row === null) throw new Error(`no audit row for ${action}`);
  return row;
}

beforeEach(() => {
  vi.stubEnv("VITE_API_URL", "http://api.test/api/v1");
  adminApi.clearAccessToken();
  adminApi.onAuthLost = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("admin audit identity links", () => {
  it("maps user, board and card targets to their detail routes", async () => {
    vi.stubGlobal("fetch", new FakeAdminServer(stateWithAudit()).fetchImpl);
    renderAdmin();

    await screen.findByText("user.impersonated");
    expect(
      await within(rowFor("user.impersonated")).findByRole("link", {
        name: "u-9",
      }),
    ).toHaveAttribute("href", "/admin/users/u-9");
    expect(
      within(rowFor("user.impersonated")).getByTestId("admin-id-u-9"),
    ).toHaveAttribute("href", "/admin/users/u-9");
    expect(
      within(rowFor("board.archive")).getByRole("link", { name: "b-9" }),
    ).toHaveAttribute("href", "/admin/boards/b-9");
    expect(
      within(rowFor("card.delete")).getByRole("link", { name: "c-9" }),
    ).toHaveAttribute("href", "/admin/cards/c-9");
  });

  it("keeps unknown and missing targets as text with a copyable id", async () => {
    vi.stubGlobal("fetch", new FakeAdminServer(stateWithAudit()).fetchImpl);
    renderAdmin();

    await screen.findByText("comment.delete");
    const unknown = rowFor("comment.delete");
    expect(
      within(unknown).queryByRole("link", { name: "comment-9" }),
    ).toBeNull();
    expect(within(unknown).getByTestId("admin-id-comment-9")).toBeTruthy();

    const missing = rowFor("admin.login");
    expect(within(missing).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("degrades a deleted target to a copyable id, not a broken route", async () => {
    vi.stubGlobal("fetch", new FakeAdminServer(stateWithAudit()).fetchImpl);
    renderAdmin();

    await screen.findByText("user.delete");
    const deleted = rowFor("user.delete");
    const target = within(deleted).getByTestId("admin-id-u-gone");
    expect(target).toBeTruthy();
    expect(within(deleted).queryByRole("link", { name: "u-gone" })).toBeNull();
  });

  it("never links an OPERATOR to the owner-only masters page", async () => {
    const server = new FakeAdminServer(stateWithAudit());
    server.sessionRole = "OPERATOR";
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin();

    await screen.findByText("user.impersonated");
    const row = rowFor("user.impersonated");
    expect(within(row).getByText("master@example.com")).toBeTruthy();
    expect(
      within(row).queryByRole("link", { name: "master@example.com" }),
    ).toBeNull();
  });

  it("links an OWNER to the masters page", async () => {
    vi.stubGlobal("fetch", new FakeAdminServer(stateWithAudit()).fetchImpl);
    renderAdmin();

    await screen.findByText("user.impersonated");
    expect(
      within(rowFor("user.impersonated")).getByRole("link", {
        name: "master@example.com",
      }),
    ).toHaveAttribute("href", "/admin/access?tab=masters");
  });

  it("links the inviter on board detail", async () => {
    const state = emptyAdminState();
    state.boards = [adminBoard()];
    const server = new FakeAdminServer(state);
    server.boardMembers["b-1"] = [
      boardMember({
        invitedById: "u-2",
        invitedByEmail: "inviter@example.com",
      }),
    ];
    vi.stubGlobal("fetch", server.fetchImpl);
    renderAdmin("/admin/boards/b-1");

    expect(
      await screen.findByTestId("admin-board-member-invited-by-member-1"),
    ).toHaveAttribute("href", "/admin/users/u-2");
  });
});
