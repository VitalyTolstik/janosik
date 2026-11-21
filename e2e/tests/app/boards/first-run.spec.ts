import { randomUUID } from "node:crypto";

import { login, test, expect } from "../../../fixtures/auth.js";

/**
 * TASK-177.16: a brand-new account names its first board, can start from the
 * example, and finds the rename control without guessing that the heading is
 * clickable.
 */

test("first run names the board and renames it from the visible pencil", async ({
  page,
  createUser,
}) => {
  const user = await createUser();
  await login(page, user);

  await expect(
    page.getByRole("heading", { name: "No board yet." }),
  ).toBeVisible();
  const create = page.getByTestId("empty-create-board");
  await expect(create).toBeDisabled();

  const name = `Launch ${randomUUID()}`;
  await page.getByTestId("empty-board-name").fill(name);
  await create.click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rename board" }),
  ).toBeVisible();

  const renamed = `Renamed ${randomUUID()}`;
  await page.getByRole("button", { name: "Rename board" }).click();
  await page.locator('[name="board-title-edit"]').fill(renamed);
  await page.locator('[name="board-title-edit"]').press("Enter");
  await expect(
    page.getByRole("heading", { name: renamed, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: renamed, exact: true }),
  ).toBeVisible();
});

test("first run can start from the example template", async ({
  page,
  createUser,
}) => {
  const user = await createUser();
  await login(page, user);

  await page.getByTestId("empty-board-name").fill(`Example ${randomUUID()}`);
  await page.getByTestId("empty-create-template").click();

  await expect(page.getByText("Welcome to your board")).toBeVisible();
  for (const column of ["To do", "In progress", "Done"]) {
    await expect(page.getByText(column, { exact: true })).toBeVisible();
  }
});
