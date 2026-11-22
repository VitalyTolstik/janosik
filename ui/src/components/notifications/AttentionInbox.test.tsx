import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AttentionNotificationDto,
  AttentionNotificationPage,
  BoardRole,
} from "@janosik/shared";

import { api } from "@/api/client";
import { AttentionInbox } from "@/components/notifications/AttentionInbox";
import { ToastProvider } from "@/components/Toast";
import { I18nProvider } from "@/i18n";
import { cardHref } from "@/utils/card-nav";

const NOW = 1_700_000_000_000;

function item(
  patch: Partial<AttentionNotificationDto> &
    Pick<AttentionNotificationDto, "id" | "type">,
): AttentionNotificationDto {
  return {
    boardId: "b-1",
    title: "Needs attention",
    body: null,
    data: null,
    readAt: null,
    createdAt: NOW,
    ...patch,
  };
}

function page(
  items: AttentionNotificationDto[],
  patch: Partial<AttentionNotificationPage> = {},
): AttentionNotificationPage {
  return {
    items,
    nextCursor: null,
    unreadCount: items.filter((row) => row.readAt === null).length,
    ...patch,
  };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">{`${location.pathname}${location.search}`}</span>
  );
}

function renderInbox(
  data: AttentionNotificationPage,
  options: {
    onNavigate?: () => void;
    entry?: string;
    roleOf?: (boardId: string) => BoardRole | undefined;
  } = {},
) {
  const onNavigate = options.onNavigate ?? vi.fn();
  const onReload = vi.fn().mockResolvedValue(undefined);
  const roleOf = options.roleOf ?? (() => "ADMIN");
  render(
    <I18nProvider>
      <ToastProvider>
        <MemoryRouter initialEntries={[options.entry ?? "/board/b-1"]}>
          <LocationProbe />
          <AttentionInbox
            page={data}
            unavailable={false}
            onReload={onReload}
            onNavigate={onNavigate}
            roleOf={roleOf}
          />
        </MemoryRouter>
      </ToastProvider>
    </I18nProvider>,
  );
  return { onNavigate, onReload };
}

describe("AttentionInbox (TASK-177.6)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("links a blocked agent row to the card deep link", () => {
    renderInbox(
      page([
        item({
          id: "blocked",
          type: "agent.blocked",
          title: "Agent blocked",
          data: { cardId: "c-1" },
        }),
        item({
          id: "claim",
          type: "claim.expired",
          title: "Claim expired",
          data: { cardId: "c-2" },
        }),
        item({
          id: "handoff",
          type: "agent.needs_human",
          title: "Agent handed off",
          data: { cardId: "c-3" },
        }),
      ]),
    );

    expect(
      screen.getByRole("link", { name: "Open “Agent blocked”" }),
    ).toHaveAttribute("href", cardHref("b-1", "c-1"));
    expect(
      screen.getByRole("link", { name: "Open “Claim expired”" }),
    ).toHaveAttribute("href", cardHref("b-1", "c-2"));
    expect(
      screen.getByRole("link", { name: "Open “Agent handed off”" }),
    ).toHaveAttribute("href", cardHref("b-1", "c-3"));
  });

  it("deep-links a mention row to its card and comment (TASK-177.12)", () => {
    renderInbox(
      page([
        item({
          id: "mention",
          type: "comment.mention",
          title: "Alice mentioned you",
          body: "On board “Launch”",
          data: { cardId: "c-1", commentId: "comment-9" },
        }),
      ]),
    );

    expect(
      screen.getByRole("link", { name: "Open “Alice mentioned you”" }),
    ).toHaveAttribute("href", `${cardHref("b-1", "c-1")}&comment=comment-9`);
  });

  it("links approvals to the board approvals tab and focus one request", () => {
    renderInbox(
      page([
        item({
          id: "approval",
          type: "approval.requested",
          title: "Approval needed",
          data: { approvalId: "apr-1" },
        }),
        item({
          id: "approval-no-id",
          type: "approval.decided",
          title: "Approval decided",
          data: {},
        }),
      ]),
    );

    const focused = screen.getByRole("link", {
      name: "Open “Approval needed”",
    });
    const focusedUrl = new URL(
      focused.getAttribute("href") ?? "",
      "http://app",
    );
    expect(focusedUrl.pathname).toBe("/board/b-1");
    expect(focusedUrl.searchParams.get("agents")).toBe("inbox");
    expect(focusedUrl.searchParams.get("approval")).toBe("apr-1");

    const queue = screen.getByRole("link", {
      name: "Open “Approval decided”",
    });
    const queueUrl = new URL(queue.getAttribute("href") ?? "", "http://app");
    expect(queueUrl.searchParams.get("agents")).toBe("inbox");
    expect(queueUrl.searchParams.has("approval")).toBe(false);
  });

  it("does not send a non-admin to the admin-only approvals tab", () => {
    renderInbox(
      page([
        item({
          id: "decided",
          type: "approval.decided",
          title: "Approval decided",
          data: { approvalId: "apr-1" },
        }),
      ]),
      { roleOf: () => "MEMBER" },
    );

    const board = screen.getByRole("link", {
      name: "Open “Approval decided”",
    });
    const boardUrl = new URL(board.getAttribute("href") ?? "", "http://app");
    expect(boardUrl.pathname).toBe("/board/b-1");
    expect(boardUrl.searchParams.has("agents")).toBe(false);
    expect(boardUrl.searchParams.has("approval")).toBe(false);
  });

  it("links a board quota to the board and an account quota to the account panel", () => {
    renderInbox(
      page([
        item({
          id: "quota-board",
          type: "quota.exceeded",
          title: "Board limit",
          boardId: "b-2",
        }),
        item({
          id: "quota-account",
          type: "quota.exceeded",
          title: "Plan limit",
          boardId: null,
        }),
      ]),
      { entry: "/board/b-1" },
    );

    expect(
      screen.getByRole("link", { name: "Open “Board limit”" }),
    ).toHaveAttribute("href", "/board/b-2");

    const account = screen.getByRole("link", { name: "Open “Plan limit”" });
    const accountUrl = new URL(
      account.getAttribute("href") ?? "",
      "http://app",
    );
    expect(accountUrl.pathname).toBe("/board/b-1");
    expect(accountUrl.searchParams.get("account")).toBe("profile");
  });

  it("links a revoked token to the account tokens section", () => {
    renderInbox(
      page([
        item({
          id: "token",
          type: "token.revoked",
          title: "Token revoked",
          boardId: null,
        }),
      ]),
      { entry: "/board/b-1?f.q=release" },
    );

    const link = screen.getByRole("link", { name: "Open “Token revoked”" });
    const url = new URL(link.getAttribute("href") ?? "", "http://app");
    expect(url.pathname).toBe("/board/b-1");
    expect(url.searchParams.get("f.q")).toBe("release");
    expect(url.searchParams.get("account")).toBe("tokens");
  });

  it("renders no link when the row has no safe target", () => {
    renderInbox(
      page([
        item({ id: "blocked", type: "agent.blocked", data: null }),
        item({
          id: "approval",
          type: "approval.requested",
          boardId: null,
          data: { approvalId: "apr-1" },
        }),
        item({ id: "unknown", type: "approval.cancelled", boardId: null }),
      ]),
    );

    expect(screen.queryByTestId("attention-link")).toBeNull();
    expect(screen.getAllByText("Needs attention")).toHaveLength(3);
  });

  it("navigates on a plain click and closes the popover without marking the row read", async () => {
    const markRead = vi.spyOn(api, "markAttentionRead");
    const { onNavigate } = renderInbox(
      page([
        item({
          id: "blocked",
          type: "agent.blocked",
          title: "Agent blocked",
          data: { cardId: "c-1" },
        }),
      ]),
    );

    await userEvent.click(
      screen.getByRole("link", { name: "Open “Agent blocked”" }),
    );

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/board/b-1?card=c-1",
    );
    expect(markRead).not.toHaveBeenCalled();
  });

  it("closes on middle click but leaves right-click alone", () => {
    const { onNavigate } = renderInbox(
      page([
        item({
          id: "blocked",
          type: "agent.blocked",
          title: "Agent blocked",
          data: { cardId: "c-1" },
        }),
      ]),
    );
    const link = screen.getByTestId("attention-link");

    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 2 }));
    expect(onNavigate).not.toHaveBeenCalled();

    fireEvent(link, new MouseEvent("auxclick", { bubbles: true, button: 1 }));
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("keeps read and read-all independent of the row links", async () => {
    const markRead = vi.spyOn(api, "markAttentionRead").mockResolvedValue(
      item({
        id: "blocked",
        type: "agent.blocked",
        title: "Agent blocked",
        data: { cardId: "c-1" },
        readAt: NOW + 1,
      }),
    );
    const markAll = vi
      .spyOn(api, "markAllAttentionRead")
      .mockResolvedValue({ updated: 1 });
    const { onReload } = renderInbox(
      page([
        item({
          id: "blocked",
          type: "agent.blocked",
          title: "Agent blocked",
          data: { cardId: "c-1" },
        }),
      ]),
    );

    const row = screen.getByText("Agent blocked").closest("li");
    expect(row).not.toBeNull();
    await userEvent.click(
      within(row as HTMLElement).getByRole("button", {
        name: "Mark as read",
      }),
    );
    await waitFor(() => expect(markRead).toHaveBeenCalledWith("blocked"));
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));

    await userEvent.click(
      screen.getByRole("button", { name: "Mark all as read" }),
    );
    await waitFor(() => expect(markAll).toHaveBeenCalledTimes(1));
  });
});
