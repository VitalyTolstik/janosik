import { test, expect } from "@/fixtures/board.js";
import { createExtraBoard } from "@/helpers/boards.js";

test("switching boards closes the settings draft before another board can save", async ({
  page,
  board,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const other = await createExtraBoard(board.api, "Alternate workflow board");
  await board.open(page);

  const settings = page.getByTestId("board-settings-trigger");
  await settings.click();
  const dialog = page.getByRole("dialog", {
    name: `Board settings: ${board.title}`,
  });
  await expect(dialog).toBeVisible();
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
  // to the new board's gear, not BODY.
  await expect(settings).toBeFocused();

  await settings.click();
  const otherSettings = page.getByRole("dialog", {
    name: `Board settings: ${other.title}`,
  });
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
  await settings.click();
  await expect(dialog.getByTestId("workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
