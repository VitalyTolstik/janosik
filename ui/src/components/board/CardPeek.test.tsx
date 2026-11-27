import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Board } from "@janosik/shared";

import { CardPeek } from "@/components/board/CardPeek";
import { I18nProvider } from "@/i18n";

const hoisted = vi.hoisted(() => ({
  board: {
    id: "board",
    title: "Launch board",
    columns: [{ id: "todo", title: "To do", cardIds: ["card"], createdAt: 1 }],
    cards: {
      card: {
        id: "card",
        title: "Release checklist",
        labelIds: [],
        createdAt: 1,
        updatedAt: 1,
        readModel: {
          descriptionChars: 42,
          checklistItemCount: 0,
          checklistDoneCount: 0,
          linkCount: 0,
          blocked: false,
          detailLoaded: false,
        },
      },
    },
    labels: [],
    createdAt: 1,
    updatedAt: 1,
  } satisfies Board,
  loadCardDetail: vi.fn(),
}));

vi.mock("@/store/BoardContext", () => ({
  useBoardState: () => ({ board: hoisted.board }),
  useBoardActions: () => ({ loadCardDetail: hoisted.loadCardDetail }),
}));

describe("CardPeek", () => {
  beforeEach(() => {
    hoisted.loadCardDetail.mockReset();
  });

  it("uses a description-specific error and retries the detail request", async () => {
    hoisted.loadCardDetail.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(
      <I18nProvider>
        <CardPeek boardId="board" cardId="card" onOpenCard={vi.fn()} />
      </I18nProvider>,
    );

    expect(
      await screen.findByText("Could not load the description."),
    ).toBeVisible();
    expect(screen.queryByText("Could not load your boards")).toBeNull();
    expect(hoisted.loadCardDetail).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() =>
      expect(hoisted.loadCardDetail).toHaveBeenCalledTimes(2),
    );
    expect(
      await screen.findByText("Could not load the description."),
    ).toBeVisible();
  });
});
