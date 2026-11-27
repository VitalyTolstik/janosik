import { test, expect } from "@/fixtures/board.js";
import { createExtraBoard } from "@/helpers/boards.js";
import { openBoardSettings } from "@/helpers/header.js";

test("forced board switch on a phone focuses the Board menu, not BODY", async ({
  page,
  board,
}) => {
  const other = await createExtraBoard(board.api, "Phone workflow board");
  await board.open(page);

  const dialog = await openBoardSettings(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", {
    name: "Search cards and boards",
  });
  await search.fill(other.title);
  await page.getByRole("option", { name: other.title }).click();

  await expect(page).toHaveURL(new RegExp(`/board/${other.id}$`));
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("board-menu-trigger")).toBeFocused();
});

test("switching boards closes the settings draft before another board can save", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const other = await createExtraBoard(board.api, "Alternate workflow board");
  await board.open(page);

  const dialog = await openBoardSettings(page);
  const workflow = dialog.getByRole("tab", { name: "Workflow" });
  await expect(workflow).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByRole("tabpanel", { name: "Workflow" }),
  ).toHaveAttribute("id", (await workflow.getAttribute("aria-controls"))!);
  await dialog.getByTestId("workflow-enabled").click();
  await dialog.getByTestId("workflow-tab-matrix").click();
  await dialog.getByTestId(`workflow-cell-${backlog}-${doing}`).click();
  await expect(dialog.getByTestId("workflow-save")).toBeEnabled();

  await page.keyboard.press("Control+k");
  const search = page.getByRole("combobox", {
    name: "Search cards and boards",
  });
  await search.fill(other.title);
  const option = page.getByRole("option", { name: other.title });
  await expect(option).toBeVisible();
  await expect(search).toHaveAttribute(
    "aria-activedescendant",
    (await option.getAttribute("id"))!,
  );
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/board/${other.id}$`));
  await expect(dialog).toBeHidden();
  // The forced switch unmounts Settings without a close event; focus belongs
  // to the new board's Board menu, not BODY.
  await expect(page.getByTestId("board-menu-trigger")).toBeFocused();

  const otherSettings = await openBoardSettings(page);
  await expect(otherSettings.getByTestId("workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(otherSettings.getByTestId("workflow-save")).toBeDisabled();
  const response = await board.api.get(`/api/v1/boards/${other.id}`);
  expect(response.ok()).toBe(true);
  expect((await response.json()).workflow).toBeUndefined();

  await page.goBack();
  await expect(page.getByTestId("board-settings-dialog")).toBeHidden();
  await openBoardSettings(page);
  await expect(dialog.getByTestId("workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
