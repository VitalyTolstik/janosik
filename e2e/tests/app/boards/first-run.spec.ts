import { randomUUID } from "node:crypto";

import { login, test, expect } from "../../../fixtures/auth.js";

/**
 * TASK-177.16: a brand-new account names its first board, can start from a
 * curated example without typing a name, and finds the visible rename control.
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
  // The example is not name-gated; the empty board is.
  await expect(page.getByTestId("empty-create-template")).toBeEnabled();

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
  const renameSaved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/commands") &&
      response.ok(),
  );
  await page.locator('[name="board-title-edit"]').press("Enter");
  await renameSaved;
  await expect(
    page.getByRole("heading", { name: renamed, exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: renamed, exact: true }),
  ).toBeVisible();
});

test("first run can create a curated example without a name", async ({
  page,
  createUser,
}) => {
  const user = await createUser();
  await login(page, user);

  await page.getByTestId("empty-create-template").click();
  const picker = page.getByTestId("template-picker");
  await expect(picker).toBeVisible();
  await expect(
    picker.getByRole("button", { name: /Product launch/ }),
  ).toHaveAttribute("aria-pressed", "true");

  const name = picker.getByLabel("Board name");
  await expect(name).toHaveValue(/^Product launch — /);
  await expect(
    picker.getByRole("heading", { name: "Write the launch brief" }),
  ).toBeVisible();
  await expect(picker.getByText("Brief checklist").first()).toBeVisible();

  await picker.getByTestId("template-create-board").click();
  await expect(
    page.getByRole("heading", { name: "Board created" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open board" }).click();

  await expect(page.getByText("Write the launch brief")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Strategy", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Launch prep", exact: true }),
  ).toBeVisible();
  await page.getByText("Write the launch brief").click();
  await expect(page.getByText("Brief checklist")).toBeVisible();
});

test("first run keyboard: pick a template and create", async ({
  page,
  createUser,
}) => {
  const user = await createUser();
  await login(page, user);

  await page.getByTestId("empty-create-template").focus();
  await page.keyboard.press("Enter");
  const picker = page.getByTestId("template-picker");
  await expect(picker).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Product launch/ }),
  ).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("button", { name: /Sprint board/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(picker.getByLabel("Board name")).toHaveValue(
    /^Sprint board \d{4}-W\d{2}$/,
  );

  await page.keyboard.press("Control+Enter");
  await expect(
    page.getByRole("heading", { name: "Board created" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByText("Ship saved views")).toBeVisible();
});

test("first run picker fits a phone viewport with a sticky CTA", async ({
  page,
  createUser,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const user = await createUser();
  await login(page, user);

  await page.getByTestId("empty-create-template").click();
  const picker = page.getByTestId("template-picker");
  await expect(picker).toBeVisible();
  const box = await picker.boundingBox();
  expect(box?.width).toBe(390);
  expect(box?.height).toBe(844);

  const create = picker.getByTestId("template-create-board");
  const createBox = await create.boundingBox();
  expect(createBox?.height).toBeGreaterThanOrEqual(44);
  expect((createBox?.y ?? 0) + (createBox?.height ?? 0)).toBeLessThanOrEqual(
    844,
  );
  await expect(picker.getByLabel("Board name")).toBeVisible();
});
