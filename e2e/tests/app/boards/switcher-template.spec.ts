import { randomUUID } from "node:crypto";

import { test, expect } from "../../../fixtures/board.js";

/**
 * The board switcher's quick-create must reach the same curated templates as
 * the first-run screen, and an empty board must stay behind an explicit,
 * name-gated form.
 */

test("switcher quick-create opens the template picker and creates the board", async ({
  page,
  board,
}) => {
  await board.open(page);
  const trigger = page.getByRole("button", { name: "Switch board" });
  await trigger.click();
  const grid = page.getByRole("grid", { name: "Switch board" });
  await expect(grid).toBeVisible();

  await page.getByTestId("switcher-create-template").click();
  const picker = page.getByTestId("template-picker");
  await expect(picker).toBeVisible();
  // The popover closed before the dialog opened: no stacked focus layers.
  await expect(grid).toBeHidden();
  await expect(
    picker.getByRole("button", { name: /Product launch/ }),
  ).toBeFocused();
  await expect(picker.getByLabel("Board name")).toHaveValue(
    /^Product launch — /,
  );
  await expect(
    picker.getByRole("region", { name: /Preview: Product launch/ }),
  ).toBeVisible();

  await picker.getByRole("button", { name: /Sprint board/ }).click();
  const name = await picker.getByLabel("Board name").inputValue();
  expect(name).toMatch(/^Sprint board \d{4}-W\d{2}$/);

  let creates = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/api/v1/boards")
    ) {
      creates += 1;
    }
  });
  await picker.getByTestId("template-create-board").click();
  await expect(
    page.getByRole("heading", { name: "Board created" }),
  ).toBeVisible();
  expect(creates).toBe(1);

  await page.getByRole("button", { name: "Open board" }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByText("Ship saved views")).toBeVisible();

  // The switcher list refreshed from the created board.
  await trigger.click();
  await expect(page.getByRole("grid", { name: "Switch board" })).toContainText(
    name,
  );
});

test("switcher empty-board path is name-gated and lands on the new board", async ({
  page,
  board,
}) => {
  await board.open(page);
  const trigger = page.getByRole("button", { name: "Switch board" });

  let creates = 0;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname.endsWith("/api/v1/boards")
    ) {
      creates += 1;
    }
  });

  await trigger.click();
  await expect(page.getByRole("grid", { name: "Switch board" })).toBeVisible();
  await page.getByTestId("switcher-create-empty").click();

  const nameInput = page.getByLabel("Board name");
  const submit = page.getByTestId("switcher-create-empty-submit");
  await expect(nameInput).toHaveValue("");
  await expect(submit).toBeDisabled();
  await expect(page.getByText("Empty boards need a name.")).toBeVisible();
  expect(creates).toBe(0);

  const name = `Empty ${randomUUID()}`;
  await nameInput.fill(name);
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  expect(creates).toBe(1);

  await trigger.click();
  await expect(page.getByRole("grid", { name: "Switch board" })).toContainText(
    name,
  );
});

test("switcher picker returns focus to the trigger on Escape", async ({
  page,
  board,
}) => {
  await board.open(page);
  const trigger = page.getByRole("button", { name: "Switch board" });
  await trigger.click();
  await page.getByTestId("switcher-create-template").click();
  const picker = page.getByTestId("template-picker");
  await expect(picker).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(picker).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
});
