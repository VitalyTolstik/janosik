import { test, expect } from "@/fixtures/board.js";
import {
  closeFilters,
  expectCardTitles,
  openFilters,
  pickFacet,
} from "@/helpers/filters.js";

async function boardWithAssignees(board: {
  userId: string;
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
  command: (action: Record<string, unknown>) => Promise<void>;
}) {
  const todo = await board.column("Todo");
  const assigned = await board.card(todo, "Assigned task");
  await board.card(todo, "Unassigned task");
  await board.command({
    type: "SET_CARD_ASSIGN",
    cardId: assigned,
    assigneeId: board.userId,
  });
}

test("filters cards by assignee", async ({ page, board }) => {
  await boardWithAssignees(board);
  await board.open(page);

  const popover = await openFilters(page);
  const member = popover.getByRole("checkbox").filter({ hasText: board.email });
  await expect(member).toBeVisible();
  await member.click();
  await closeFilters(page);

  await expectCardTitles(page, ["Assigned task"]);
});

test("filters unassigned cards and combines them with an assignee", async ({
  page,
  board,
}) => {
  await boardWithAssignees(board);
  await board.open(page);

  await pickFacet(page, "checkbox", "Unassigned");
  await expectCardTitles(page, ["Unassigned task"]);

  const popover = await openFilters(page);
  await popover.getByRole("checkbox").filter({ hasText: board.email }).click();
  await closeFilters(page);

  await expectCardTitles(page, ["Assigned task", "Unassigned task"]);
});
