import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  expectAudit,
  expectToast,
  loginAsMaster,
  ownerCredentials,
} from "@/helpers/admin.js";

test("a master edits the workflow on behalf of the owner and the change is audited", async ({
  page,
  board,
  admin,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  await board.card(backlog, "Master task");
  await loginAsMaster(page, ownerCredentials());

  await page.goto(adminPath(`boards/${board.id}/workflow`), {
    waitUntil: "domcontentloaded",
  });
  const editor = page.getByTestId("admin-workflow-editor");
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("admin-workflow-enabled")).toHaveAttribute(
    "aria-checked",
    "false",
  );

  await page.getByTestId("admin-workflow-enabled").click();
  await page.getByTestId("admin-workflow-tab-matrix").click();
  await page.getByTestId(`admin-workflow-cell-${backlog}-${doing}`).click();
  await page.getByTestId("admin-workflow-initial").click();
  await page.getByTestId(`admin-workflow-initial-option-${backlog}`).click();
  await page.getByTestId("admin-workflow-save").click();
  await expectToast(page, "Workflow saved");

  const aggregateResponse = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(aggregateResponse.ok()).toBeTruthy();
  const aggregate = (await aggregateResponse.json()) as {
    workflow?: {
      enabled: boolean;
      initialColumnId?: string;
      doneColumnIds: string[];
      transitions: unknown[];
    };
  };
  expect(aggregate.workflow).toMatchObject({
    enabled: true,
    initialColumnId: backlog,
    doneColumnIds: [],
  });
  expect(aggregate.workflow?.transitions).toHaveLength(1);

  await expectAudit(admin, {
    action: "board.command",
    targetId: board.id,
    detailsText: "SET_BOARD_WORKFLOW",
  });
});

test("browser Back confirms a dirty workflow draft", async ({
  page,
  board,
}) => {
  await board.column("Backlog");
  await loginAsMaster(page, ownerCredentials());
  // Reach the editor through SPA links so browser Back is a client-side POP
  // that the router blocker can intercept (a full page.goto would be a
  // document navigation).
  await page
    .getByTestId("admin-sidebar")
    .getByRole("link", { name: "Boards", exact: true })
    .click();
  await page.getByTestId(`admin-board-row-${board.id}`).press("Enter");
  await page.getByRole("link", { name: "Open workflow editor" }).click();
  const toggle = page.getByTestId("admin-workflow-enabled");
  await toggle.click();

  await page.goBack();
  const dialog = page.getByRole("dialog", { name: /unsaved|discard/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/\/workflow$/);

  await page.goBack();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /discard/i }).click();
  await expect(page).toHaveURL((url) =>
    url.pathname.endsWith(`/admin/boards/${board.id}`),
  );
});

test("an OPERATOR saves the workflow through the same audited path", async ({
  page,
  board,
  admin,
  operator,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  await loginAsMaster(page, operator);

  await page.goto(adminPath(`boards/${board.id}/workflow`), {
    waitUntil: "domcontentloaded",
  });
  const editor = page.getByTestId("admin-workflow-editor");
  await expect(editor).toBeVisible();
  await page.getByTestId("admin-workflow-enabled").click();
  await page.getByTestId("admin-workflow-tab-matrix").click();
  await page.getByTestId(`admin-workflow-cell-${backlog}-${doing}`).click();
  await page.getByTestId("admin-workflow-save").click();
  await expectToast(page, "Workflow saved");

  const aggregateResponse = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(aggregateResponse.ok()).toBeTruthy();
  const aggregate = (await aggregateResponse.json()) as {
    workflow?: { enabled: boolean; transitions: unknown[] };
  };
  expect(aggregate.workflow?.enabled).toBe(true);
  expect(aggregate.workflow?.transitions).toHaveLength(1);

  await expectAudit(admin, {
    action: "board.command",
    targetId: board.id,
    detailsText: "SET_BOARD_WORKFLOW",
  });
});

test("Back and sidebar navigation confirm a dirty workflow draft", async ({
  page,
  board,
}) => {
  await board.column("Backlog");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`boards/${board.id}/workflow`));
  const toggle = page.getByTestId("admin-workflow-enabled");
  await toggle.click();

  await page.getByRole("link", { name: "Back", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /unsaved|discard/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page).toHaveURL(/\/workflow$/);

  await page
    .getByTestId("admin-sidebar")
    .getByRole("link", { name: "Users", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /discard/i }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
});
