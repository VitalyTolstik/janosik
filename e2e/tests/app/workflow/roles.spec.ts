import { test, expect } from "@/fixtures/collaboration.js";
import { columnSection, cardTitle } from "@/helpers/history.js";
import { dragCard } from "@/helpers/workflow.js";

test("a MEMBER cannot edit the workflow and is refused by a role-only edge", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Admin only");
  await board.command({
    type: "SET_BOARD_WORKFLOW",
    workflow: {
      schemaVersion: 1,
      enabled: true,
      initialColumnId: backlog,
      doneColumnIds: [done],
      transitions: [
        {
          id: "any-done",
          fromColumnId: null,
          toColumnId: done,
          allowedRoles: ["ADMIN"],
        },
      ],
    },
  });
  await partner.invite("MEMBER");
  await partner.accept();
  await partner.openBoard(partnerBrowser.page);

  await expect(
    partnerBrowser.page.getByTestId("board-settings-trigger"),
  ).toHaveCount(0);

  await cardTitle(partnerBrowser.page, "Admin only").click({ button: "right" });
  await partnerBrowser.page.getByTestId("ctx-move-trigger").click();
  const content = partnerBrowser.page.getByTestId("ctx-move-content");
  await expect(content.getByTestId(`ctx-move-${done}`)).toBeDisabled();
  await expect(content.getByTestId(`ctx-move-reason-${done}`)).toContainText(
    "ADMIN",
  );
  await partnerBrowser.page.keyboard.press("Escape");
  await partnerBrowser.page.keyboard.press("Escape");

  await dragCard(partnerBrowser.page, "Backlog", "Admin only", "Done");
  await expect(
    partnerBrowser.page.locator(".janosik-toast").filter({
      hasText: "Backlog → Done",
    }),
  ).toBeVisible();
  await expect(
    columnSection(partnerBrowser.page, "Backlog").getByTestId("card-title"),
  ).toHaveText("Admin only");

  // The owner (ADMIN) can use the same edge.
  await board.open(page);
  await dragCard(page, "Backlog", "Admin only", "Done");
  await expect(
    columnSection(page, "Done").getByTestId("card-title"),
  ).toHaveText("Admin only");
});

test("a VIEWER gets no settings, no drag and no move menu", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Read only");
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
  await partner.invite("VIEWER");
  await partner.accept();
  await partner.openBoard(partnerBrowser.page);

  await expect(
    partnerBrowser.page.getByTestId("board-settings-trigger"),
  ).toHaveCount(0);
  await cardTitle(partnerBrowser.page, "Read only").click({ button: "right" });
  await expect(partnerBrowser.page.getByTestId("ctx-move-trigger")).toHaveCount(
    0,
  );
  await expect(
    partnerBrowser.page.getByTestId("ctx-workflow-rules"),
  ).toBeVisible();
  await partnerBrowser.page.keyboard.press("Escape");
  await expect(
    partnerBrowser.page.getByTestId(`column-workflow-blocked-${done}`),
  ).toHaveCount(0);
  await expect(
    columnSection(partnerBrowser.page, "Backlog").getByTestId("card-title"),
  ).toHaveText("Read only");
});
