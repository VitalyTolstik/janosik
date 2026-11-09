import { randomUUID } from "node:crypto";

import { test, expect } from "@/fixtures/collaboration.js";
import {
  cardDialog,
  cardTitle,
  closeCardDialog,
  descriptionEditor,
  openCard,
  openCardContextMenu,
} from "@/helpers/history.js";

test.describe.configure({ timeout: 60_000 });

test("a VIEWER gets no mutating card affordances", async ({
  page,
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Read only card");
  const labelId = await board.label("Design", "green");
  await board.command({
    type: "SET_CARD_LABEL",
    cardId,
    labelId,
    on: true,
  });
  const checklistId = randomUUID();
  await board.command({
    type: "ADD_CHECKLIST",
    cardId,
    newChecklistId: checklistId,
    title: "DoD",
  });
  await board.command({
    type: "ADD_CHECKLIST_ITEM",
    cardId,
    checklistId,
    newItemId: randomUUID(),
    text: "A frozen step",
  });
  const comment = await board.api.post(`/api/v1/cards/${cardId}/comments`, {
    data: { text: "Visible comment" },
  });
  expect(comment.status()).toBe(201);
  const attachment = await board.api.post(
    `/api/v1/cards/${cardId}/attachments`,
    {
      multipart: {
        file: {
          name: "visible.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("visible"),
        },
      },
    },
  );
  expect(attachment.status()).toBe(201);

  await partner.invite("MEMBER");
  await partner.accept();
  const demoted = await board.api.patch(
    `/api/v1/boards/${board.id}/members/${partner.userId}`,
    { data: { role: "VIEWER" } },
  );
  expect(demoted.ok()).toBeTruthy();
  await board.open(page);
  await partner.openBoard(partnerBrowser.page);
  await expect.poll(() => partner.role()).toBe("VIEWER");

  await openCard(partnerBrowser.page, "Read only card");
  const dialog = cardDialog(partnerBrowser.page);

  await expect(dialog.getByRole("textbox", { name: "Title" })).toHaveJSProperty(
    "readOnly",
    true,
  );
  await expect(descriptionEditor(partnerBrowser.page)).toHaveAttribute(
    "contenteditable",
    "false",
  );

  await expect(dialog.getByRole("button", { name: "Labels" })).toHaveCount(0);
  await expect(dialog.getByTestId("priority-trigger")).toHaveCount(0);
  await expect(dialog.getByTestId("due-date-trigger")).toHaveCount(0);
  await expect(dialog.getByTestId("card-assignee-trigger")).toHaveCount(0);
  await expect(dialog.getByTestId("card-assignee-readout")).toBeVisible();

  await expect(
    dialog.getByRole("button", { name: "Add checklist" }),
  ).toHaveCount(0);
  await expect(dialog.locator('[name="checklist-new-item"]')).toHaveCount(0);
  await dialog.locator('[data-testid^="checklist-toggle-"]').click();
  await expect(dialog.getByText("A frozen step", { exact: true })).toHaveCount(
    1,
  );

  await expect(dialog.getByTestId("comment-send")).toHaveCount(0);
  await expect(dialog.getByTestId("comment-delete")).toHaveCount(0);
  await expect(dialog.getByTestId("comment-list")).toContainText(
    "Visible comment",
  );

  await expect(dialog.getByTestId("card-attachments-upload")).toHaveCount(0);
  const attachmentRow = dialog
    .getByTestId("card-attachment-row")
    .filter({ hasText: "visible.txt" });
  await expect(attachmentRow).toBeVisible();
  await expect(
    attachmentRow.getByRole("button", { name: "Remove attachment" }),
  ).toHaveCount(0);

  await dialog.getByRole("button", { name: "Card actions" }).click();
  await expect(
    partnerBrowser.page.getByRole("menuitem", { name: "Open in new tab" }),
  ).toBeVisible();
  await expect(
    partnerBrowser.page.getByRole("menuitem", { name: "Duplicate card" }),
  ).toHaveCount(0);
  await expect(
    partnerBrowser.page.getByRole("menuitem", { name: "Archive", exact: true }),
  ).toHaveCount(0);
  await expect(
    partnerBrowser.page.getByRole("menuitem", { name: "Delete card" }),
  ).toHaveCount(0);
  await partnerBrowser.page.keyboard.press("Escape");
  await closeCardDialog(partnerBrowser.page);

  const menu = await openCardContextMenu(partnerBrowser.page, "Read only card");
  await expect(menu.getByTestId("ctx-open")).toBeVisible();
  await expect(menu.getByTestId("ctx-copy-link")).toBeVisible();
  await expect(menu.getByTestId("ctx-open-new-tab")).toBeVisible();
  await expect(menu.getByTestId("ctx-duplicate")).toHaveCount(0);
  await expect(menu.getByTestId("ctx-archive")).toHaveCount(0);
  for (const item of ["Labels", "Due date", "Priority", "Assignee", "Cover"]) {
    await expect(menu.getByText(item, { exact: true })).toHaveCount(0);
  }
  await partnerBrowser.page.keyboard.press("Escape");
  await expect(cardTitle(partnerBrowser.page, "Read only card")).toBeVisible();
});
