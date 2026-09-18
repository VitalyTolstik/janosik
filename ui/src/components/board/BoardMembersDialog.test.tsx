import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type { BoardMemberDto } from "@janosik/shared";

import { ApiError, api } from "@/api/client";
import { BoardMembersPanel } from "@/components/board/BoardMembersDialog";
import { ToastProvider } from "@/components/Toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardLiveProvider, createBoardLive } from "@/store/board-live";

/**
 * Members modal (TASK-35): the invite/role/remove flows an ADMIN gets, the
 * read-only list everyone else gets, error mapping to toasts and the
 * last-ADMIN guard.
 *
 * The panel is rendered the way the dialog renders it — inside a Radix
 * `DialogContent` — so `DialogTitle` has its context. The API is stubbed
 * per test; no fake server is needed for the modal itself.
 */

const ADMIN: BoardMemberDto = {
  userId: "user-1",
  displayName: "Boris",
  email: "boris@example.com",
  role: "ADMIN",
  expiresAt: null,
};

const MEMBER: BoardMemberDto = {
  userId: "user-2",
  displayName: null,
  email: "quiet@example.com",
  role: "MEMBER",
  expiresAt: null,
};

function renderPanel(canManage: boolean, children?: ReactNode) {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <ToastProvider>
          <Dialog open>
            <DialogContent>
              <BoardMembersPanel boardId="board-1" canManage={canManage} />
              {children}
            </DialogContent>
          </Dialog>
        </ToastProvider>
      </TooltipProvider>
    </I18nProvider>,
  );
}

describe("BoardMembersPanel (TASK-35)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("lists members with name, email and role for an ADMIN", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, MEMBER]);

    renderPanel(true);

    expect(await screen.findByText("Boris")).toBeInTheDocument();
    expect(screen.getAllByText("quiet@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Members (2)")).toBeInTheDocument();
    expect(screen.getAllByTestId("user-avatar")).toHaveLength(2);
    expect(screen.getAllByTestId("board-member-row")).toHaveLength(2);
    expect(screen.getByTestId("board-members-invite")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Role of Boris" }),
    ).toHaveTextContent("Admin");
  });

  it("filters the roster by name or email and shows an empty state", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, MEMBER]);

    renderPanel(true);
    await screen.findByText("Boris");

    const search = screen.getByLabelText("Search members…");
    fireEvent.change(search, { target: { value: "quiet" } });
    expect(screen.getAllByTestId("board-member-row")).toHaveLength(1);
    expect(screen.queryByText("Boris")).not.toBeInTheDocument();
    // The header keeps reporting the whole roster, not the filtered slice.
    expect(screen.getByText("Members (2)")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "nobody" } });
    expect(screen.queryAllByTestId("board-member-row")).toHaveLength(0);
    expect(screen.getByText("No members found")).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "boris@example.com" } });
    expect(screen.getAllByTestId("board-member-row")).toHaveLength(1);
    expect(screen.getByText("Boris")).toBeInTheDocument();
  });

  it("invites by email and keeps the pending invitation out of the list", async () => {
    const list = vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    const invite = vi.spyOn(api, "inviteMember").mockResolvedValue({
      userId: "user-9",
      displayName: "Newbie",
      email: "new@example.com",
      role: "MEMBER",
      expiresAt: null,
    });

    renderPanel(true);
    await screen.findByText("Boris");

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "new@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(invite).toHaveBeenCalledWith("board-1", {
      email: "new@example.com",
      role: "MEMBER",
      expiresAt: undefined,
    });
    expect(
      await screen.findByText("Invitation sent to new@example.com"),
    ).toBeInTheDocument();
    // Opt-in invitations (TASK-35 addendum): the invitee is not a member
    // until they accept, so the dialog refetches and shows the same one row.
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Newbie")).not.toBeInTheDocument();
    expect(screen.getByText("Members (1)")).toBeInTheDocument();
  });

  it("maps invite failures to specific toasts (404 unknown user)", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    vi.spyOn(api, "inviteMember").mockRejectedValue(
      new ApiError(404, { message: "No user with that email" }),
    );

    renderPanel(true);
    await screen.findByText("Boris");

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "ghost@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(
      await screen.findByText("No user with that email"),
    ).toBeInTheDocument();
  });

  it("changes a role through the API and reflects it in the row", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, MEMBER]);
    const update = vi.spyOn(api, "updateMember").mockResolvedValue({
      ...MEMBER,
      role: "VIEWER",
      expiresAt: 1_800_000_000_000,
    });

    renderPanel(true);
    await screen.findByText("Boris");

    fireEvent.click(
      screen.getByRole("button", { name: "Role of quiet@example.com" }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Viewer" }));

    expect(update).toHaveBeenCalledWith("board-1", "user-2", {
      role: "VIEWER",
    });
    expect(
      await screen.findByRole("button", {
        name: "Role of quiet@example.com",
      }),
    ).toHaveTextContent("Viewer");
    expect(await screen.findByText("Role updated")).toBeInTheDocument();
  });

  it("sets a VIEWER expiry through the calendar popover", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([
      ADMIN,
      { ...MEMBER, role: "VIEWER", expiresAt: null },
    ]);
    const update = vi.spyOn(api, "updateMember").mockResolvedValue({
      ...MEMBER,
      role: "VIEWER",
      expiresAt: 1,
    });

    renderPanel(true);
    await screen.findByText("Boris");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Access until — quiet@example.com",
      }),
    );
    await screen.findByTestId("expiry-calendar");
    // The calendar arrives in a lazy chunk (TASK-19); under full-suite load
    // its import can exceed the 1 s default waitFor timeout.
    await waitFor(
      () => {
        expect(
          document.querySelectorAll("button[data-day]").length,
        ).toBeGreaterThan(0);
      },
      { timeout: 15_000 },
    );
    const target = [
      ...document.querySelectorAll<HTMLElement>("button[data-day]"),
    ].find(
      (button) =>
        button.textContent === "15" &&
        !button.closest("td")?.hasAttribute("data-outside"),
    );
    fireEvent.click(target as HTMLElement);

    await waitFor(() => expect(update).toHaveBeenCalled());
    const now = new Date();
    expect(update).toHaveBeenCalledWith("board-1", "user-2", {
      expiresAt: new Date(
        now.getFullYear(),
        now.getMonth(),
        15,
        12,
        0,
      ).toISOString(),
    });
  });

  it("locks demote/remove for the last ADMIN with a reason", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);

    renderPanel(true);
    await screen.findByText("Boris");

    const picker = screen.getByRole("button", { name: "Role of Boris" });
    expect(picker).toBeDisabled();
    expect(picker.closest("span")).toHaveAttribute(
      "title",
      "The last admin cannot be demoted or removed",
    );
    expect(
      screen.getByRole("button", { name: "Remove — Boris" }),
    ).toBeDisabled();
  });

  it("removes a member after the inline confirmation", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, MEMBER]);
    const remove = vi
      .spyOn(api, "removeMember")
      .mockResolvedValue({ status: "ok" });

    renderPanel(true);
    await screen.findAllByText("quiet@example.com");

    fireEvent.click(
      screen.getByRole("button", { name: "Remove — quiet@example.com" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));

    expect(remove).toHaveBeenCalledWith("board-1", "user-2");
    expect(await screen.findByText("Member removed")).toBeInTheDocument();
    expect(screen.queryAllByText("quiet@example.com")).toHaveLength(0);
  });

  it("gives MEMBER/VIEWER the same list read-only", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, MEMBER]);

    renderPanel(false);
    await screen.findByText("Boris");

    expect(
      screen.queryByTestId("board-members-invite"),
    ).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("role-trigger")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Remove — Boris" }),
    ).not.toBeInTheDocument();
    const rows = screen.getAllByTestId("board-member-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText("Member")).toBeInTheDocument();
  });

  it("offers a retry when the list fails to load", async () => {
    const list = vi
      .spyOn(api, "listMembers")
      .mockRejectedValueOnce(new ApiError(0, null));

    renderPanel(true);

    expect(
      await screen.findByText("Could not load members"),
    ).toBeInTheDocument();
    list.mockResolvedValueOnce([ADMIN]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Boris")).toBeInTheDocument();
  });

  it("reloads an open list when the directory changes live", async () => {
    const list = vi
      .spyOn(api, "listMembers")
      .mockResolvedValueOnce([ADMIN])
      .mockResolvedValueOnce([ADMIN, MEMBER]);
    const live = createBoardLive();

    render(
      <I18nProvider>
        <TooltipProvider>
          <ToastProvider>
            <BoardLiveProvider live={live}>
              <Dialog open>
                <DialogContent>
                  <BoardMembersPanel boardId="board-1" canManage />
                </DialogContent>
              </Dialog>
            </BoardLiveProvider>
          </ToastProvider>
        </TooltipProvider>
      </I18nProvider>,
    );
    await screen.findByText("Boris");
    expect(screen.queryByText("quiet@example.com")).not.toBeInTheDocument();

    // A realtime membership event rewrites the directory store…
    act(() => {
      live.members.set("board-1", [ADMIN, MEMBER]);
    });

    // …and the open dialog re-reads the directory on its own.
    expect(
      (await screen.findAllByText("quiet@example.com")).length,
    ).toBeGreaterThan(0);
    expect(list).toHaveBeenCalledTimes(2);
  });
});
