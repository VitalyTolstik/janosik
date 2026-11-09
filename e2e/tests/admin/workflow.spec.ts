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
  await page.getByTestId(`admin-workflow-cell-${backlog}-${doing}`).click();
  await page.getByTestId("admin-workflow-initial").selectOption(backlog);
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

test("an OPERATOR can open the same workflow editor", async ({
  page,
  board,
  operator,
}) => {
  await board.column("Backlog");
  await board.column("Doing");
  await loginAsMaster(page, operator);

  await page.goto(adminPath(`boards/${board.id}/workflow`), {
    waitUntil: "domcontentloaded",
  });
  await expect(page.getByTestId("admin-workflow-editor")).toBeVisible();
  await expect(page.getByTestId("admin-workflow-enabled")).toBeVisible();
});
