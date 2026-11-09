import { test, expect } from "@/fixtures/collaboration.js";
import { columnSection } from "@/helpers/history.js";
import {
  allowTransition,
  dragCard,
  openBoardSettings,
  saveWorkflow,
} from "@/helpers/workflow.js";

test("a second browser sees a workflow change live in both directions", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const backlog = await board.column("Backlog");
  const doing = await board.column("Doing");
  const done = await board.column("Done");
  await board.card(backlog, "Realtime task");
  await partner.invite("MEMBER");
  await partner.accept();
  await partner.openBoard(partnerBrowser.page);
  await board.open(page);

  // Enable control in the owner's browser; the member's browser receives the
  // SET_BOARD_WORKFLOW command over SSE.
  const dialog = await openBoardSettings(page);
  await dialog.getByTestId("workflow-enabled").click();
  await allowTransition(page, backlog, doing);
  await saveWorkflow(page);
  await partnerBrowser.page.waitForTimeout(1_000);

  await dragCard(partnerBrowser.page, "Backlog", "Realtime task", "Done");
  await expect(
    partnerBrowser.page.locator(".janosik-toast").filter({
      hasText: "Backlog → Done",
    }),
  ).toBeVisible();
  await expect(
    columnSection(partnerBrowser.page, "Backlog").getByTestId("card-title"),
  ).toHaveText("Realtime task");

  // Disabling the control reaches the member live as well: the same drag now
  // succeeds without a reload.
  const reopen = await openBoardSettings(page);
  await reopen.getByTestId("workflow-enabled").click();
  await saveWorkflow(page);
  await partnerBrowser.page.waitForTimeout(1_000);

  await dragCard(partnerBrowser.page, "Backlog", "Realtime task", "Done");
  await expect(
    columnSection(partnerBrowser.page, "Done").getByTestId("card-title"),
  ).toHaveText("Realtime task");
});
