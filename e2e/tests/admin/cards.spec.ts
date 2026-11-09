import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/admin.js";
import {
  adminPath,
  confirmAction,
  expectAudit,
  loginAsMaster,
  ownerCredentials,
  searchAdminList,
  uniqueToken,
} from "@/helpers/admin.js";
import { seedRichCard } from "@/helpers/admin-content.js";

/**
 * Cards list and detail (TASK-162.15 full): search/status, archive/restore/
 * delete, the whole support graph and the confirmed detail delete.
 */

test("C1: archiving a card from the list keeps it restorable", async ({
  page,
  admin,
  board,
}) => {
  const columnId = await board.column(uniqueToken("card-list-column"));
  const title = uniqueToken("card-list");
  const cardId = await board.card(columnId, title);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("cards"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "cards", title);
  const row = page.getByTestId(`admin-card-row-${cardId}`);
  await expect(row).toContainText("Active");

  await page.getByTestId(`admin-row-actions-${cardId}`).click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await confirmAction(page);
  await expect(row).toContainText("Archived");
  await expectAudit(admin, { action: "card.archive", targetId: cardId });
});

test("C2: restoring then deleting an archived card", async ({
  page,
  admin,
  board,
}) => {
  const columnId = await board.column(uniqueToken("card-restore-column"));
  const title = uniqueToken("card-restore");
  const cardId = await board.card(columnId, title);
  await board.command({ type: "ARCHIVE_CARD", cardId });
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath("cards"), { waitUntil: "domcontentloaded" });
  await searchAdminList(page, "cards", title);
  const row = page.getByTestId(`admin-card-row-${cardId}`);
  await expect(row).toContainText("Archived");

  await page.getByTestId(`admin-row-actions-${cardId}`).click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(row).toContainText("Active");

  await page.getByTestId(`admin-row-actions-${cardId}`).click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await confirmAction(page);
  await expect(row).toContainText("Deleted");
  await expectAudit(admin, { action: "card.delete", targetId: cardId });
});

test("C3: card detail renders the whole support graph", async ({
  page,
  board,
}) => {
  const seeded = await seedRichCard(board);
  const incomingTitle = uniqueToken("incoming-card");
  const incomingId = await board.card(seeded.columnId, incomingTitle);
  await board.command({
    type: "ADD_CARD_LINK",
    cardId: incomingId,
    linkId: randomUUID(),
    targetCardId: seeded.cardId,
    linkType: "relates_to",
  });
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`cards/${seeded.cardId}`), {
    waitUntil: "domcontentloaded",
  });

  await expect(
    page.getByRole("heading", { name: seeded.title, exact: true }),
  ).toBeVisible();
  const meta = page.getByTestId("admin-card-detail-meta");
  await expect(meta).toContainText(board.title);
  await expect(meta).toContainText(board.email);
  await expect(meta).toContainText(/\d+/);
  await expect(page.getByTestId("admin-card-status")).toHaveText("Active");
  await expect(page.getByTestId("admin-card-detail-description")).toContainText(
    seeded.description,
  );
  await expect(page.getByTestId("admin-card-detail-labels")).toContainText(
    /Label/,
  );
  const checklists = page.getByTestId("admin-card-detail-checklists");
  await expect(checklists).toContainText("1/2");
  await expect(checklists).toContainText(seeded.itemTexts[0]);
  await expect(checklists).toContainText(seeded.itemTexts[1]);
  const links = page.getByTestId("admin-card-detail-links");
  await expect(links).toContainText("blocks");
  await expect(links).toContainText("relates_to");
  await expect(links).toContainText(seeded.otherCardTitle);
  await expect(links).toContainText(incomingTitle);
  await expect(page.getByTestId("admin-card-detail-attachments")).toContainText(
    seeded.fileName,
  );
  await expect(page.getByTestId("admin-card-detail-comments")).toContainText(
    seeded.commentText,
  );
  const timeline = page.getByTestId("admin-card-detail-timeline");
  await expect(timeline).toContainText("ADD_CARD");
  await expect(timeline).toContainText("comment_added");
});

test("C4: card detail archive, restore and confirmed delete", async ({
  page,
  admin,
  board,
}) => {
  const seeded = await seedRichCard(board);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`cards/${seeded.cardId}`), {
    waitUntil: "domcontentloaded",
  });
  const status = page.getByTestId("admin-card-status");

  await page.getByTestId("admin-card-detail-actions").click();
  await page.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(status).toHaveText("Archived");

  await page.getByTestId("admin-card-detail-actions").click();
  await page.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect(status).toHaveText("Active");

  await page.getByTestId("admin-card-detail-actions").click();
  await page.getByRole("menuitem", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("admin-confirm-accept")).toBeVisible();
  await confirmAction(page);
  await expect(status).toHaveText("Deleted");
  await expectAudit(admin, { action: "card.delete", targetId: seeded.cardId });
});
