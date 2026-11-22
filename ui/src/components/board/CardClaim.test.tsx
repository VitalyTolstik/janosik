import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CardClaim } from "@/components/board/CardClaim";
import { I18nProvider } from "@/i18n";
import { BoardLiveProvider, createBoardLive } from "@/store/board-live";
import { canReleaseCardClaim } from "@/utils/card-permissions";
import type { BoardMemberDto } from "@janosik/shared";

const releaseCardClaim = vi.hoisted(() => vi.fn());

vi.mock("@/store/BoardContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/BoardContext")>();
  return {
    ...actual,
    useBoardActions: () => ({ releaseCardClaim }),
  };
});

const MEMBERS: BoardMemberDto[] = [
  {
    userId: "u-alice",
    displayName: "Alice",
    email: "alice@example.com",
    role: "ADMIN",
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  },
  {
    userId: "u-boris",
    displayName: "Boris",
    email: "boris@example.com",
    role: "MEMBER",
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  },
];

function renderClaim(
  props: Partial<Parameters<typeof CardClaim>[0]> = {},
): ReturnType<typeof render> {
  const live = createBoardLive();
  live.members.set("b-1", MEMBERS);
  return render(
    <I18nProvider>
      <BoardLiveProvider live={live}>
        <CardClaim
          boardId="b-1"
          cardId="card-1"
          claimedBy="u-alice"
          leaseUntil={Date.now() + 900_000}
          role="MEMBER"
          userId="u-boris"
          {...props}
        />
      </BoardLiveProvider>
    </I18nProvider>,
  );
}

describe("CardClaim (TASK-177.4)", () => {
  beforeEach(() => releaseCardClaim.mockClear());

  it("renders the claimant and the lease for every member", () => {
    renderClaim();
    const pill = screen.getByTestId("card-claim");
    expect(pill).toHaveTextContent("Claimed by Alice");
    expect(pill).toHaveTextContent("until");
    // A different MEMBER sees the claim but gets no release control.
    expect(screen.queryByTestId("card-claim-release")).toBeNull();
  });

  it("offers release to the claim owner", () => {
    renderClaim({ userId: "u-alice" });
    expect(screen.getByTestId("card-claim-release")).toBeInTheDocument();
  });

  it("offers release to a board ADMIN", () => {
    renderClaim({ role: "ADMIN" });
    expect(screen.getByTestId("card-claim-release")).toBeInTheDocument();
  });

  it("never offers release to a VIEWER or read-only mount", () => {
    const { unmount } = renderClaim({ role: "VIEWER", userId: "u-alice" });
    expect(screen.queryByTestId("card-claim-release")).toBeNull();
    unmount();
    renderClaim({ role: "ADMIN", readOnly: true });
    expect(screen.queryByTestId("card-claim-release")).toBeNull();
  });

  it("confirms before releasing and never ends the session implicitly", () => {
    renderClaim({ userId: "u-alice" });
    fireEvent.click(screen.getByTestId("card-claim-release"));
    expect(releaseCardClaim).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/does not end the agent session/i),
    ).toBeInTheDocument();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Release claim" }),
    );

    expect(releaseCardClaim).toHaveBeenCalledWith("card-1");
  });

  it("shows an expired lease honestly", () => {
    renderClaim({ leaseUntil: Date.now() - 1_000 });
    expect(screen.getByTestId("card-claim")).toHaveTextContent(/expired/i);
  });

  it("renders nothing without a claim", () => {
    renderClaim({ claimedBy: undefined, leaseUntil: undefined });
    expect(screen.queryByTestId("card-claim")).toBeNull();
  });
});

describe("canReleaseCardClaim (TASK-177.4 decision 1)", () => {
  const base = { role: "MEMBER" as const, readOnly: false };

  it("allows the owner and a board ADMIN", () => {
    expect(
      canReleaseCardClaim({
        ...base,
        userId: "u-alice",
        claimedBy: "u-alice",
      }),
    ).toBe(true);
    expect(
      canReleaseCardClaim({
        ...base,
        role: "ADMIN",
        userId: "u-boris",
        claimedBy: "u-alice",
      }),
    ).toBe(true);
  });

  it("denies another member, a VIEWER and a read-only mount", () => {
    expect(
      canReleaseCardClaim({
        ...base,
        userId: "u-boris",
        claimedBy: "u-alice",
      }),
    ).toBe(false);
    expect(
      canReleaseCardClaim({
        ...base,
        role: "VIEWER",
        userId: "u-alice",
        claimedBy: "u-alice",
      }),
    ).toBe(false);
    expect(
      canReleaseCardClaim({
        ...base,
        role: "ADMIN",
        userId: "u-boris",
        claimedBy: "u-alice",
        readOnly: true,
      }),
    ).toBe(false);
  });
});
