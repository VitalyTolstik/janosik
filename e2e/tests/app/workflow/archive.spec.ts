import { test, expect } from "@/fixtures/board.js";
import { columnSection, cardTitle } from "@/helpers/history.js";
import { openArchive } from "@/helpers/search.js";

/**
 * Recovery is a column change: an archived card may only come back to its
 * original column unless the workflow allows the target. The archive dialog
 * pre-checks it exactly like the Move-to menu, and the server answers 409 for
 * a client that tries the forbidden target anyway.
 */
test("archive restore refuses a column outside the workflow", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Recoverable task");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: backlog,
      doneColumnIds: [done],
      transitions: [
        { id: "backlog-doing", fromColumnId: backlog, toColumnId: doing },
      ],
    },
  });
  await board.open(page);

  await cardTitle(page, "Recoverable task").click({ button: "right" });
  await page.getByTestId("ctx-archive").click();
  await expect(
    page.getByTestId("card-title").filter({ hasText: "Recoverable task" }),
  ).toHaveCount(0);

  const archive = await openArchive(page);
  const row = archive
    .getByTestId("archive-row")
    .filter({ hasText: "Recoverable task" });
  await expect(row).toBeVisible();
  await row.getByTestId("archive-restore").click();

  const doingItem = page.getByRole("menuitem", { name: "Doing", exact: true });
  const doneItem = page.getByRole("menuitem", { name: "Done", exact: true });
  const backlogItem = page.getByRole("menuitem", {
    name: "Backlog",
    exact: true,
  });
  await expect(doneItem).toHaveAttribute("aria-disabled", "true");
  await expect(doneItem).toHaveAttribute(
    "title",
    /not allowed by the workflow/,
  );
  await expect(doingItem).toBeEnabled();
  await expect(backlogItem).toBeEnabled();

  // Restoring to the original column is the safe path.
  await backlogItem.click();
  await expect(row).toHaveCount(0);
  // Radix marks the board aria-hidden while the archive dialog is open, so
  // role queries cannot see the restored card until it closes.
  await archive.getByRole("button", { name: "Close" }).click();
  await expect(
    columnSection(page, "Backlog").getByTestId("card-title"),
  ).toHaveText("Recoverable task");
});
