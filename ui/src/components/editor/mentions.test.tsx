import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mentionMarkdown } from "@janosik/shared";

import { UserProfileProvider } from "@/components/board/UserProfileDialog";
import { ToastProvider } from "@/components/Toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardLiveProvider, createBoardLive } from "@/store/board-live";
import { CommentBody } from "./CommentEditor";

// Lexical needs these when it commits a selection in jsdom.
if (typeof Range !== "undefined") {
  const zeroRect = (): DOMRect =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
    }) as DOMRect;
  Range.prototype.getBoundingClientRect ??= zeroRect;
  Range.prototype.getClientRects ??= () =>
    ({ length: 0, item: () => null }) as unknown as DOMRectList;
}

describe("comment mention rendering (TASK-177.12)", () => {
  it("renders an explicit mention as an internal profile link", async () => {
    const text = `Ping ${mentionMarkdown("Alice", "user-1")} please`;

    render(<CommentBody text={text} />);

    await waitFor(() => {
      const anchor = document.querySelector(
        '.janosik-md-content a[href="https://janosik.invalid/mention/user-1"]',
      );
      expect(anchor).not.toBeNull();
      expect(anchor).toHaveTextContent("@Alice");
    });
  });

  it("opens the mentioned member profile from the chip", async () => {
    const live = createBoardLive();
    live.members.set("b-1", [
      {
        userId: "user-1",
        displayName: "Alice",
        email: "alice@example.com",
        role: "MEMBER",
        expiresAt: null,
        avatarColor: null,
        avatarPath: null,
      },
    ]);
    render(
      <I18nProvider>
        <ToastProvider>
          <TooltipProvider>
            <BoardLiveProvider live={live}>
              <UserProfileProvider boardId="b-1">
                <CommentBody text={mentionMarkdown("Alice", "user-1")} />
              </UserProfileProvider>
            </BoardLiveProvider>
          </TooltipProvider>
        </ToastProvider>
      </I18nProvider>,
    );

    const anchor = await waitFor(() => {
      const found = document.querySelector(
        '.janosik-md-content a[href="https://janosik.invalid/mention/user-1"]',
      );
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    fireEvent.click(anchor);

    expect(await screen.findByTestId("user-profile-dialog")).toBeVisible();
    expect(screen.getByTestId("user-profile-name")).toHaveTextContent("Alice");
  });

  it("swallows a malformed mention URL instead of navigating", async () => {
    render(
      <CommentBody
        text={"[@Ann](https://janosik.invalid/mention/u1?next=evil)"}
      />,
    );

    const anchor = await waitFor(() => {
      const found = document.querySelector(".janosik-md-content a");
      expect(found).not.toBeNull();
      return found as HTMLAnchorElement;
    });
    expect(anchor.getAttribute("href")).toContain("?next=evil");
    const event = createEvent.click(anchor);
    fireEvent(anchor, event);
    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByTestId("user-profile-dialog")).toBeNull();
  });

  it("does not execute or render raw HTML around a mention", async () => {
    const text = `${mentionMarkdown("Bob", "user-2")} <img src=x onerror="alert(1)"><script>alert(2)</script>`;

    render(<CommentBody text={text} />);

    await waitFor(() => {
      expect(document.querySelector(".janosik-md-content")).toHaveTextContent(
        "@Bob",
      );
    });
    expect(document.querySelector(".janosik-md-content img")).toBeNull();
    expect(document.querySelector(".janosik-md-content script")).toBeNull();
  });
});
