import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CardAssignee } from "@/components/board/CardAssignee";
import { TooltipProvider } from "@/components/ui/tooltip";
import { I18nProvider } from "@/i18n";
import { BoardLiveProvider, createBoardLive } from "@/store/board-live";
import type { BoardMemberDto } from "@janosik/shared";

const setCardAssign = vi.hoisted(() => vi.fn());

vi.mock("@/store/BoardContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/store/BoardContext")>();
  return {
    ...actual,
    useBoardActions: () => ({ setCardAssign }),
  };
});

const MEMBERS: BoardMemberDto[] = [
  {
    userId: "u-boris",
    displayName: "Boris",
    email: "boris@example.com",
    role: "MEMBER",
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  },
  {
    userId: "u-alice",
    displayName: "Alice",
    email: "alice@example.com",
    role: "ADMIN",
    expiresAt: null,
    avatarColor: null,
    avatarPath: null,
  },
];

function renderPicker(props: Partial<Parameters<typeof CardAssignee>[0]> = {}) {
  const live = createBoardLive();
  live.members.set("b-1", MEMBERS);
  return render(
    <I18nProvider>
      <TooltipProvider>
        <BoardLiveProvider live={live}>
          <CardAssignee boardId="b-1" cardId="c-1" {...props} />
        </BoardLiveProvider>
      </TooltipProvider>
    </I18nProvider>,
  );
}

describe("CardAssignee (TASK-49)", () => {
  it("shows Unassigned on an unassigned card", () => {
    renderPicker();
    expect(screen.getByTestId("card-assignee-trigger")).toHaveTextContent(
      "Unassigned",
    );
  });

  it("searches the roster and assigns on click", async () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("card-assignee-trigger"));
    const input = await screen.findByTestId("card-assignee-input");
    expect(screen.getByTestId("card-assignee-option-u-boris")).toBeTruthy();
    expect(screen.getByTestId("card-assignee-option-u-alice")).toBeTruthy();

    fireEvent.change(input, { target: { value: "ali" } });
    await waitFor(() =>
      expect(screen.queryByTestId("card-assignee-option-u-boris")).toBeNull(),
    );
    fireEvent.click(screen.getByTestId("card-assignee-option-u-alice"));

    expect(setCardAssign).toHaveBeenCalledWith("c-1", "u-alice");
  });

  it("unassigns from the pinned row", () => {
    renderPicker({ assigneeId: "u-boris" });
    expect(screen.getByTestId("card-assignee-trigger")).toHaveTextContent(
      "Boris",
    );
    fireEvent.click(screen.getByTestId("card-assignee-trigger"));
    fireEvent.click(screen.getByTestId("card-assignee-unassign"));

    expect(setCardAssign).toHaveBeenCalledWith("c-1", null);
  });

  it("picks the first suggestion with ArrowDown + Enter", () => {
    renderPicker();
    fireEvent.click(screen.getByTestId("card-assignee-trigger"));
    const input = screen.getByTestId("card-assignee-input");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    // The cursor starts on the pinned "Unassigned" row; one ArrowDown lands
    // on the first suggestion — alphabetically sorted, so Alice.
    expect(setCardAssign).toHaveBeenCalledWith("c-1", "u-alice");
  });

  it("renders a plain readout for VIEWERs", () => {
    renderPicker({ assigneeId: "u-boris", readOnly: true });
    expect(screen.getByTestId("card-assignee-readout")).toHaveTextContent(
      "Boris",
    );
    expect(screen.queryByTestId("card-assignee-trigger")).toBeNull();
  });
});
