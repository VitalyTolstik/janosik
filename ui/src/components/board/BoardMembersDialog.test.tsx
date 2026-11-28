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
import type {
  BoardMemberDto,
  BoardPendingInvitationDto,
} from "@janosik/shared";

import { ApiError, api } from "@/api/client";
import { BoardMembersPanel } from "@/components/board/BoardMembersDialog";
import { ToastProvider } from "@/components/Toast";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider, formatDateOnly } from "@/i18n";
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
  avatarColor: null,
  avatarPath: null,
};

const MEMBER: BoardMemberDto = {
  userId: "user-2",
  displayName: null,
  email: "quiet@example.com",
  role: "MEMBER",
  expiresAt: null,
  avatarColor: null,
  avatarPath: null,
};

function renderPanel(
  canManage: boolean,
  children?: ReactNode,
  currentUserId?: string,
  onLeave?: (boardId: string) => Promise<boolean>,
  boardTitle?: string,
) {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <ToastProvider>
          <Dialog open>
            <DialogContent>
              <BoardMembersPanel
                boardId="board-1"
                boardTitle={boardTitle}
                canManage={canManage}
                currentUserId={currentUserId}
                onLeave={onLeave}
              />
              {children}
            </DialogContent>
          </Dialog>
        </ToastProvider>
      </TooltipProvider>
    </I18nProvider>,
  );
}

describe("BoardMembersPanel (TASK-35)", () => {
  it("shows a busy roster skeleton while the members load", async () => {
    let release!: (members: BoardMemberDto[]) => void;
    vi.spyOn(api, "listMembers").mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderPanel(true);

    const skeleton = await screen.findByTestId("board-members-skeleton");
    expect(skeleton).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByTestId("board-members-skeleton-row")).toHaveLength(4);

    act(() => release([ADMIN, MEMBER]));
    expect(await screen.findByText("Boris")).toBeInTheDocument();
    expect(screen.queryByTestId("board-members-skeleton")).toBeNull();
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(api, "listPendingInvitations").mockResolvedValue([]);
  });

  it("lists members with name, email and role for an ADMIN", async () => {
    const list = vi
      .spyOn(api, "listMembers")
      .mockResolvedValue([ADMIN, MEMBER]);

    renderPanel(true);

    expect(await screen.findByText("Boris")).toBeInTheDocument();
    // M15: the admin's management list asks for lapsed VIEWER rows, unlike
    // the pickers that consume the default active roster.
    expect(list).toHaveBeenCalledWith("board-1", { includeExpired: true });
    expect(screen.getAllByText("quiet@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("Members (2)")).toBeInTheDocument();
    expect(screen.getAllByTestId("user-avatar")).toHaveLength(2);
    expect(screen.getAllByTestId("board-member-row")).toHaveLength(2);
    expect(screen.getByTestId("board-members-invite")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^Role of Boris\b/ }),
    ).toHaveTextContent("Admin");
  });

  it("keeps a long self profile and a lapsed expiry readable on a narrow row", async () => {
    const self: BoardMemberDto = {
      ...ADMIN,
      displayName: null,
      email: "owner-20261127212322@v1review.example",
    };
    const lapsed: BoardMemberDto = {
      ...MEMBER,
      userId: "user-3",
      displayName: null,
      email: "lapsed-20261127212322@v1review.example",
      role: "VIEWER",
      expiresAt: Date.now() - 60_000,
    };
    vi.spyOn(api, "listMembers").mockResolvedValue([self, lapsed]);

    renderPanel(true, undefined, self.userId);

    const [selfRow] = await screen.findAllByTestId("board-member-row");
    const selfOpen = within(selfRow).getByTestId("board-member-open");
    // 390: the profile owns a full wrapped row instead of collapsing beside
    // the role/leave controls; 768+: it goes back to one flex line.
    expect(selfOpen.className).toContain("basis-full");
    expect(selfOpen.className).toContain("sm:basis-0");
    expect(within(selfRow).getByTestId("board-member-email")).toHaveTextContent(
      self.email,
    );
    expect(selfRow).toHaveTextContent("owner-20261127212322@v1review.example");

    const lapsedRow = screen
      .getAllByTestId("board-member-row")
      .find((row) => row.dataset.userId === lapsed.userId)!;
    const expiry = within(lapsedRow).getByTestId("board-member-expiry");
    expect(expiry).toHaveTextContent(/until .*access expired/);
    // No ellipsis: the complete expiry sentence stays in the DOM and the row
    // is allowed to grow instead of hiding the lapsed state.
    expect(expiry.className).not.toContain("truncate");
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

  it("shows an inline error for an invalid invitation email", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    const invite = vi.spyOn(api, "inviteMember");
    renderPanel(true);
    await screen.findByText("Boris");
    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "invalid-email" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid email address.",
    );
    expect(invite).not.toHaveBeenCalled();
  });

  it("invites by email and keeps the pending invitation out of the list", async () => {
    const list = vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    // The server answers every address with the same masked projection
    // (`userId: ""`) — it never says whether the account exists.
    const invite = vi.spyOn(api, "inviteMember").mockResolvedValue({
      userId: "",
      displayName: null,
      email: "new@example.com",
      role: "MEMBER",
      expiresAt: null,
      avatarColor: null,
      avatarPath: null,
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
      await screen.findByText(
        "If new@example.com has a Janosik account, they'll see the invitation",
      ),
    ).toBeInTheDocument();
    // Opt-in invitations (TASK-35 addendum): the invitee is not a member
    // until they accept, so the dialog refetches and shows the same one row
    // — no phantom row for the masked answer.
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getAllByTestId("board-member-row")).toHaveLength(1);
    expect(screen.getByText("Members (1)")).toBeInTheDocument();
  });

  it("maps an invite of an existing member to a specific toast (409)", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    vi.spyOn(api, "inviteMember").mockRejectedValue(
      new ApiError(409, { message: "User is already a board member" }),
    );

    renderPanel(true);
    await screen.findByText("Boris");

    fireEvent.change(screen.getByLabelText("Email"), {
      target: { value: "boris@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(
      await screen.findByText("This user is already a member of the board"),
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
      screen.getByRole("button", { name: /^Role of quiet@example\.com\b/ }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Viewer" }));

    expect(update).toHaveBeenCalledWith("board-1", "user-2", {
      role: "VIEWER",
    });
    expect(
      await screen.findByRole("button", {
        name: /^Role of quiet@example\.com\b/,
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
        name: /^Access until — quiet@example\.com\b/,
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
    const days = [
      ...document.querySelectorAll<HTMLElement>(
        "td[data-day] button:not([disabled])",
      ),
    ].filter((button) => !button.closest("td")?.hasAttribute("data-outside"));
    const target =
      days.find((button) => {
        const value = button.closest("td")?.getAttribute("data-day");
        return value != null && new Date(`${value}T12:00:00`) > new Date();
      }) ?? days[days.length - 1];
    const day = target.closest("td")?.getAttribute("data-day");
    const chosen = new Date(`${day}T12:00:00`);
    fireEvent.click(target as HTMLElement);

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith("board-1", "user-2", {
      expiresAt: chosen.toISOString(),
    });
  });

  it("locks demote/remove for the last ADMIN with a reason", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);

    renderPanel(true);
    await screen.findByText("Boris");

    const picker = screen.getByRole("button", { name: /^Role of Boris\b/ });
    expect(picker).toBeDisabled();
    expect(picker.closest("span")).toHaveAttribute(
      "title",
      "The last admin cannot be demoted or removed",
    );
    expect(
      screen.getByRole("button", { name: "Remove — Boris" }),
    ).toBeDisabled();
  });

  it("offers Leave board in the caller's own row and confirms first (TASK-177.2)", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, MEMBER]);
    const leave = vi.fn().mockResolvedValue(true);

    renderPanel(false, undefined, MEMBER.userId, leave);
    const row = (await screen.findAllByTestId("board-member-row")).find(
      (item) => item.getAttribute("data-user-id") === MEMBER.userId,
    );
    expect(row).toBeDefined();

    fireEvent.click(within(row!).getByTestId("board-member-leave"));
    expect(
      within(row!).getByTestId("member-leave-confirm"),
    ).toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
    // The Yes action takes focus; cancelling returns it to Leave.
    expect(
      within(row!).getByRole("button", { name: "Yes, leave" }),
    ).toHaveFocus();

    fireEvent.click(within(row!).getByRole("button", { name: "Cancel" }));
    expect(
      within(row!).queryByTestId("member-leave-confirm"),
    ).not.toBeInTheDocument();
    expect(leave).not.toHaveBeenCalled();
    expect(within(row!).getByTestId("board-member-leave")).toHaveFocus();

    fireEvent.click(within(row!).getByTestId("board-member-leave"));
    fireEvent.click(within(row!).getByRole("button", { name: "Yes, leave" }));
    await waitFor(() => expect(leave).toHaveBeenCalledWith("board-1"));
  });

  it("locks Leave board for the last ADMIN and keeps admin removal for others", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, MEMBER]);
    const leave = vi.fn().mockResolvedValue(false);

    renderPanel(true, undefined, ADMIN.userId, leave);
    const own = (await screen.findAllByTestId("board-member-row")).find(
      (item) => item.getAttribute("data-user-id") === ADMIN.userId,
    );
    const other = screen
      .getAllByTestId("board-member-row")
      .find((item) => item.getAttribute("data-user-id") === MEMBER.userId);
    expect(own).toBeDefined();
    expect(other).toBeDefined();

    const button = within(own!).getByTestId("board-member-leave");
    expect(button).toBeDisabled();
    expect(button.closest("span")).toHaveAttribute(
      "title",
      "The last admin cannot leave — promote another admin first",
    );
    const reasonId = button.getAttribute("aria-describedby");
    expect(reasonId).toBeTruthy();
    expect(document.getElementById(reasonId!)).toHaveTextContent(
      "The last admin cannot leave — promote another admin first",
    );
    // The own row uses Leave instead of the admin's remove-other control.
    expect(
      within(own!).queryByRole("button", { name: "Remove — Boris" }),
    ).not.toBeInTheDocument();
    expect(
      within(other!).getByRole("button", {
        name: "Remove — quiet@example.com",
      }),
    ).toBeEnabled();
  });

  it("shows the board title in the dialog header", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    renderPanel(true, undefined, undefined, undefined, "Roadmap board");

    expect(await screen.findByText("Boris")).toBeInTheDocument();
    expect(screen.getByTestId("board-members-board-title")).toHaveTextContent(
      "Roadmap board",
    );
  });

  it("keeps Remove for other admins while the own row offers Leave", async () => {
    const secondAdmin: BoardMemberDto = {
      ...MEMBER,
      userId: "user-2",
      role: "ADMIN",
    };
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, secondAdmin]);
    const leave = vi.fn().mockResolvedValue(true);

    renderPanel(true, undefined, ADMIN.userId, leave);
    const own = (await screen.findAllByTestId("board-member-row")).find(
      (item) => item.getAttribute("data-user-id") === ADMIN.userId,
    );
    const other = screen
      .getAllByTestId("board-member-row")
      .find((item) => item.getAttribute("data-user-id") === secondAdmin.userId);

    expect(within(own!).getByTestId("board-member-leave")).toBeEnabled();
    expect(
      within(own!).queryByRole("button", { name: "Remove — Boris" }),
    ).not.toBeInTheDocument();
    expect(
      within(other!).getByRole("button", {
        name: "Remove — quiet@example.com",
      }),
    ).toBeEnabled();
  });

  it("maps a last-admin refusal to the admin message, not 'already a member'", async () => {
    const secondAdmin: BoardMemberDto = { ...MEMBER, role: "ADMIN" };
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN, secondAdmin]);
    vi.spyOn(api, "updateMember").mockRejectedValue(
      new ApiError(409, {
        message: "Cannot demote the last ADMIN of the board",
        code: "last_admin",
        action: "demote",
      }),
    );

    renderPanel(true);
    await screen.findByText("Boris");
    fireEvent.click(screen.getByRole("button", { name: /^Role of Boris\b/ }));
    fireEvent.click(screen.getByRole("radio", { name: "Member" }));

    expect(
      await screen.findByText("The last admin cannot be demoted or removed"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("This user is already a member of the board"),
    ).not.toBeInTheDocument();
  });

  it("refreshes the roster after a refused leave and disables the stale action", async () => {
    const lastAdmin: BoardMemberDto = {
      ...MEMBER,
      userId: "user-2",
      role: "ADMIN",
      displayName: "Boris",
      email: "boris@example.com",
    };
    const firstAdmin: BoardMemberDto = {
      ...ADMIN,
      userId: "user-1",
      displayName: "Ada",
      email: "ada@example.com",
    };
    const list = vi
      .spyOn(api, "listMembers")
      .mockResolvedValueOnce([firstAdmin, lastAdmin])
      .mockResolvedValueOnce([lastAdmin]);
    const leave = vi.fn().mockResolvedValue(false);

    renderPanel(true, undefined, lastAdmin.userId, leave);
    const row = (await screen.findAllByTestId("board-member-row")).find(
      (item) => item.getAttribute("data-user-id") === lastAdmin.userId,
    );
    fireEvent.click(within(row!).getByTestId("board-member-leave"));
    fireEvent.click(within(row!).getByRole("button", { name: "Yes, leave" }));

    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("board-member-leave")).toBeDisabled(),
    );
    expect(
      screen.queryByTestId("member-leave-confirm"),
    ).not.toBeInTheDocument();
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

  it("shows an expired VIEWER and lets an admin remove them", async () => {
    vi.spyOn(api, "listMembers").mockResolvedValue([
      ADMIN,
      { ...MEMBER, role: "VIEWER", expiresAt: Date.now() - 1_000 },
    ]);
    const remove = vi
      .spyOn(api, "removeMember")
      .mockResolvedValue({ status: "ok" });

    renderPanel(true);
    expect(await screen.findByText(/access expired/)).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Remove — quiet@example.com" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Yes, remove" }));
    expect(remove).toHaveBeenCalledWith("board-1", "user-2");
  });

  it("gives MEMBER/VIEWER the same list read-only", async () => {
    const list = vi
      .spyOn(api, "listMembers")
      .mockResolvedValue([ADMIN, MEMBER]);

    renderPanel(false);
    await screen.findByText("Boris");
    expect(list).toHaveBeenCalledWith("board-1", { includeExpired: false });

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

  it("adapts the own row when a live role change demotes the caller", async () => {
    const secondAdmin: BoardMemberDto = {
      ...MEMBER,
      userId: "user-2",
      role: "ADMIN",
    };
    const demotedSelf: BoardMemberDto = { ...ADMIN, role: "MEMBER" };
    vi.spyOn(api, "listMembers")
      .mockResolvedValueOnce([ADMIN, secondAdmin])
      .mockResolvedValueOnce([demotedSelf, secondAdmin]);
    const live = createBoardLive();

    render(
      <I18nProvider>
        <TooltipProvider>
          <ToastProvider>
            <BoardLiveProvider live={live}>
              <Dialog open>
                <DialogContent>
                  <BoardMembersPanel
                    boardId="board-1"
                    canManage
                    currentUserId={ADMIN.userId}
                    onLeave={vi.fn().mockResolvedValue(true)}
                  />
                </DialogContent>
              </Dialog>
            </BoardLiveProvider>
          </ToastProvider>
        </TooltipProvider>
      </I18nProvider>,
    );
    await screen.findByText("Boris");
    expect(
      screen.getByRole("button", { name: /^Role of Boris\b/ }),
    ).toHaveTextContent("Admin");

    act(() => {
      live.members.set("board-1", [demotedSelf, secondAdmin]);
    });

    await waitFor(() =>
      expect(screen.getByTestId("board-member-leave")).toBeEnabled(),
    );
    const own = screen
      .getAllByTestId("board-member-row")
      .find((row) => row.getAttribute("data-user-id") === ADMIN.userId);
    expect(own).toHaveAttribute("data-role", "MEMBER");
    expect(within(own!).getByText("Member")).toBeInTheDocument();
  });

  it("lists pending invitations and cancels one", async () => {
    const invitation: BoardPendingInvitationDto = {
      id: "invite-1",
      userId: "user-3",
      displayName: null,
      email: "pending@example.com",
      role: "VIEWER",
      expiresAt: null,
      createdAt: Date.now(),
    };
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    vi.spyOn(api, "listPendingInvitations").mockResolvedValue([invitation]);
    const remove = vi
      .spyOn(api, "removeMember")
      .mockResolvedValue({ status: "ok" });

    renderPanel(true);

    const row = await screen.findByTestId("board-pending-row");
    expect(row).toHaveTextContent("pending@example.com");
    expect(row).toHaveTextContent("Viewer");
    fireEvent.click(within(row).getByTestId("board-pending-cancel"));

    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith("board-1", "user-3"),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("board-pending-row")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Invitation cancelled")).toBeInTheDocument();
  });

  it("changes a pending invitation's role through updateMember", async () => {
    const invitation: BoardPendingInvitationDto = {
      id: "invite-1",
      userId: "user-3",
      displayName: null,
      email: "pending@example.com",
      role: "VIEWER",
      expiresAt: null,
      createdAt: Date.now(),
    };
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    vi.spyOn(api, "listPendingInvitations").mockResolvedValue([invitation]);
    const update = vi.spyOn(api, "updateMember").mockResolvedValue({
      userId: invitation.userId,
      displayName: null,
      email: invitation.email,
      role: "MEMBER",
      expiresAt: null,
      avatarColor: null,
      avatarPath: null,
    });

    renderPanel(true);

    const row = await screen.findByTestId("board-pending-row");
    fireEvent.click(
      within(row).getByRole("button", {
        name: "Role of pending@example.com — currently Viewer",
      }),
    );
    fireEvent.click(screen.getByRole("radio", { name: "Member" }));

    expect(update).toHaveBeenCalledWith("board-1", "user-3", {
      role: "MEMBER",
    });
    await waitFor(() =>
      expect(
        within(row).getByRole("button", {
          name: "Role of pending@example.com — currently Member",
        }),
      ).toHaveTextContent("Member"),
    );
    // Expiry belongs to VIEWER only — the picker leaves with the role.
    expect(
      within(row).queryByRole("button", {
        name: /^Access until for pending@example\.com/,
      }),
    ).toBeNull();
    expect(await screen.findByText("Role updated")).toBeInTheDocument();
  });

  it("sets a pending VIEWER invitation's expiry through updateMember", async () => {
    const invitation: BoardPendingInvitationDto = {
      id: "invite-1",
      userId: "user-3",
      displayName: null,
      email: "pending@example.com",
      role: "VIEWER",
      expiresAt: null,
      createdAt: Date.now(),
    };
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    vi.spyOn(api, "listPendingInvitations").mockResolvedValue([invitation]);
    const update = vi
      .spyOn(api, "updateMember")
      .mockImplementation(async (_boardId, _userId, request) => ({
        userId: invitation.userId,
        displayName: null,
        email: invitation.email,
        role: "VIEWER",
        expiresAt:
          request.expiresAt === null || request.expiresAt === undefined
            ? null
            : Date.parse(request.expiresAt),
        avatarColor: null,
        avatarPath: null,
      }));

    renderPanel(true);

    const row = await screen.findByTestId("board-pending-row");
    fireEvent.click(
      within(row).getByRole("button", {
        name: "Access until for pending@example.com — currently no expiry",
      }),
    );
    await screen.findByTestId("expiry-calendar");
    await waitFor(
      () => {
        expect(
          document.querySelectorAll("button[data-day]").length,
        ).toBeGreaterThan(0);
      },
      { timeout: 15_000 },
    );
    const days = [
      ...document.querySelectorAll<HTMLElement>(
        "td[data-day] button:not([disabled])",
      ),
    ].filter((button) => !button.closest("td")?.hasAttribute("data-outside"));
    const target =
      days.find((button) => {
        const value = button.closest("td")?.getAttribute("data-day");
        return value != null && new Date(`${value}T12:00:00`) > new Date();
      }) ?? days[days.length - 1];
    const day = target.closest("td")?.getAttribute("data-day");
    const chosen = new Date(`${day}T12:00:00`);
    fireEvent.click(target as HTMLElement);

    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith("board-1", "user-3", {
      expiresAt: chosen.toISOString(),
    });
    const expiryTrigger = within(row).getByRole("button", {
      name: /^Access until for pending@example\.com/,
    });
    expect(expiryTrigger).toHaveTextContent(
      formatDateOnly(chosen.getTime(), "en"),
    );
    expect(await screen.findByText("Expiry updated")).toBeInTheDocument();
  });

  it("refuses a pending expiry in the past without calling updateMember", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2030, 0, 15, 23, 30));
    try {
      const invitation: BoardPendingInvitationDto = {
        id: "invite-1",
        userId: "user-3",
        displayName: null,
        email: "pending@example.com",
        role: "VIEWER",
        expiresAt: null,
        createdAt: Date.now(),
      };
      vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
      vi.spyOn(api, "listPendingInvitations").mockResolvedValue([invitation]);
      const update = vi.spyOn(api, "updateMember");

      renderPanel(true);

      const row = await screen.findByTestId("board-pending-row");
      fireEvent.click(
        within(row).getByRole("button", {
          name: "Access until for pending@example.com — currently no expiry",
        }),
      );
      await screen.findByTestId("expiry-calendar");
      await waitFor(
        () => {
          expect(
            document.querySelectorAll("button[data-day]").length,
          ).toBeGreaterThan(0);
        },
        { timeout: 15_000 },
      );
      const today = document.querySelector<HTMLElement>(
        'td[data-day="2030-01-15"] button',
      );
      expect(today).not.toBeNull();
      fireEvent.click(today!);

      expect(
        await screen.findByText("Pick a deadline in the future"),
      ).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks an expired pending invitation", async () => {
    const invitation: BoardPendingInvitationDto = {
      id: "invite-1",
      userId: "user-3",
      displayName: null,
      email: "pending@example.com",
      role: "VIEWER",
      expiresAt: Date.now() - 60_000,
      createdAt: Date.now() - 120_000,
    };
    vi.spyOn(api, "listMembers").mockResolvedValue([ADMIN]);
    vi.spyOn(api, "listPendingInvitations").mockResolvedValue([invitation]);

    renderPanel(true);

    const row = await screen.findByTestId("board-pending-row");
    expect(within(row).getByTestId("board-pending-expired")).toHaveTextContent(
      "Invitation expired",
    );
    expect(within(row).getByTestId("board-pending-expired")).toHaveClass(
      "text-danger",
    );
  });
});
