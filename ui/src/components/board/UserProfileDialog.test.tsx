import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BoardMemberDto, PresenceUser } from "@janosik/shared";

import {
  UserProfileProvider,
  useOpenProfile,
} from "@/components/board/UserProfileDialog";
import { I18nProvider } from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  BoardLiveProvider,
  createBoardLive,
  type BoardLive,
} from "@/store/board-live";

/**
 * The read-only member profile (TASK-36.1 addendum): one dialog serves every
 * face on the board. The member directory is the source of truth, the
 * presence roster fills in the live status — and doubles as the fallback for
 * a face seen before the directory loaded.
 */

const ANNA: BoardMemberDto = {
  userId: "u-anna",
  displayName: "Anna Owner",
  email: "anna@example.com",
  role: "ADMIN",
  expiresAt: null,
  avatarColor: "pink",
  avatarPath: null,
};

const VIKTOR: BoardMemberDto = {
  userId: "u-viktor",
  displayName: "Viktor Viewer",
  email: "viktor@example.com",
  role: "VIEWER",
  expiresAt: Date.UTC(2030, 0, 1),
  avatarColor: null,
  avatarPath: null,
};

const ANNA_ONLINE: PresenceUser = {
  id: "u-anna",
  displayName: "Anna Owner",
  avatarColor: "pink",
  avatarPath: null,
};

function Trigger({ userId }: { userId: string }) {
  const open = useOpenProfile();
  return (
    <button type="button" onClick={() => open(userId)}>
      open {userId}
    </button>
  );
}

function renderDialog(live: BoardLive, userId: string) {
  return render(
    <I18nProvider>
      <TooltipProvider>
        <BoardLiveProvider live={live}>
          <UserProfileProvider boardId="b-1">
            <Trigger userId={userId} />
          </UserProfileProvider>
        </BoardLiveProvider>
      </TooltipProvider>
    </I18nProvider>,
  );
}

function seededLive(users: PresenceUser[]): BoardLive {
  const live = createBoardLive();
  live.members.set("b-1", [ANNA, VIKTOR]);
  live.presence.set("b-1", users);
  return live;
}

describe("UserProfileDialog", () => {
  it("opens a member's profile with role and live status", () => {
    const live = seededLive([ANNA_ONLINE]);
    renderDialog(live, ANNA.userId);

    expect(screen.queryByTestId("user-profile-dialog")).toBeNull();
    fireEvent.click(screen.getByText(`open ${ANNA.userId}`));

    expect(screen.getByTestId("user-profile-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("user-profile-name")).toHaveTextContent(
      "Anna Owner",
    );
    expect(screen.getByTestId("user-profile-email")).toHaveTextContent(
      "anna@example.com",
    );
    expect(screen.getByTestId("user-profile-role")).toHaveTextContent("Admin");
    expect(screen.getByTestId("user-profile-status")).toHaveTextContent(
      "On the board now",
    );
    expect(screen.queryByTestId("user-profile-access")).toBeNull();
  });

  it("shows an offline member with the access deadline", () => {
    const live = seededLive([]);
    renderDialog(live, VIKTOR.userId);
    fireEvent.click(screen.getByText(`open ${VIKTOR.userId}`));

    expect(screen.getByTestId("user-profile-status")).toHaveTextContent(
      "Not on the board",
    );
    expect(screen.getByTestId("user-profile-role")).toHaveTextContent("Viewer");
    expect(screen.getByTestId("user-profile-access")).toHaveTextContent(
      "until",
    );
  });

  it("falls back to the presence roster before the directory loads", () => {
    const live = createBoardLive();
    live.presence.set("b-1", [ANNA_ONLINE]);
    renderDialog(live, ANNA.userId);
    fireEvent.click(screen.getByText(`open ${ANNA.userId}`));

    // The directory is empty — the face and the name still come from the
    // roster, only the role stays unknown.
    expect(screen.getByTestId("user-profile-name")).toHaveTextContent(
      "Anna Owner",
    );
    expect(screen.getByTestId("user-profile-role")).toHaveTextContent("—");
  });
});
