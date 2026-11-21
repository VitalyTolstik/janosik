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

test("C5: a master edits the description and opens the correlated audit row", async ({
  page,
  admin,
  board,
}) => {
  const seeded = await seedRichCard(board);
  const nextDescription = uniqueToken("admin-description");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`cards/${seeded.cardId}`), {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("admin-card-detail-description")).toContainText(
    seeded.description,
  );
  await page.getByTestId("admin-card-detail-actions").click();
  await page.getByTestId("admin-card-edit-description").click();
  const dialog = page.getByTestId("admin-card-description-dialog");
  await expect(
    dialog.getByTestId("admin-card-description-owner-notice"),
  ).toContainText(
    "You are acting as the board owner; this change appears as the owner in the board history.",
  );
  await dialog
    .getByTestId("admin-card-description-input")
    .fill(nextDescription);
  await dialog.getByTestId("admin-card-description-submit").click();
  await expect(page.getByTestId("admin-card-detail-description")).toContainText(
    nextDescription,
  );

  const auditResponse = await admin.get(
    `/api/v1/admin/audit?limit=100&search=${encodeURIComponent(board.id)}`,
  );
  expect(auditResponse.ok(), await auditResponse.text()).toBeTruthy();
  const audit = (await auditResponse.json()) as {
    items: Array<{
      id: string;
      action: string;
      details: Record<string, unknown> | null;
    }>;
  };
  const row = audit.items.find(
    (entry) =>
      entry.action === "board.command" &&
      entry.details?.type === "UPDATE_CARD" &&
      entry.details?.masterEmail === ownerCredentials().email,
  );
  expect(row).toBeDefined();
  const commandId = String(row?.details?.commandId);
  expect(commandId).not.toBe("undefined");

  const timelineLink = page.getByTestId(
    `admin-card-timeline-audit-command-${commandId}`,
  );
  await expect(timelineLink).toBeVisible();
  await timelineLink.click();
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname.endsWith("/admin/audit") &&
      url.searchParams.get("tab") === "audit" &&
      url.searchParams.get("commandId") === commandId
    );
  });
  await expect(page.getByTestId("admin-filter-clear-commandId")).toBeVisible();
  const auditRow = page.getByRole("row").filter({ hasText: "board.command" });
  await expect(auditRow).toHaveCount(1);
  await auditRow.locator("button[aria-expanded]").click();
  await expect(auditRow.locator("pre")).toContainText(commandId);
});

test("C6: a master edits card fields and every change has a command and audit row", async ({
  page,
  admin,
  board,
}) => {
  const seeded = await seedRichCard(board);
  const secondLabelId = await board.label(uniqueToken("field-label"), "green");
  const nextTitle = uniqueToken("field-title");
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`cards/${seeded.cardId}`), {
    waitUntil: "domcontentloaded",
  });

  await expect(page.getByTestId("admin-card-field-owner-notice")).toContainText(
    "You are acting as the board owner; this change appears as the owner in the board history.",
  );

  // Title — UPDATE_CARD.
  await page.getByTestId("admin-card-title-input").fill(nextTitle);
  await page.getByTestId("admin-card-title-save").click();
  await expect(
    page.getByRole("heading", { name: nextTitle, exact: true }),
  ).toBeVisible();

  // Assignee — SET_CARD_ASSIGN (null clears).
  const assignee = page.getByTestId("admin-card-field-assignee-select");
  await expect(assignee).toHaveValue(board.userId);
  await assignee.selectOption("");
  await expect(assignee).toHaveValue("");

  // Due date — clear by omitting dueDate.
  await expect(page.getByTestId("admin-card-due-remove")).toBeVisible();
  await page.getByTestId("admin-card-due-remove").click();
  await expect(page.getByTestId("admin-card-due-remove")).toHaveCount(0);

  // Priority — SET_CARD_PRIORITY.
  await page
    .getByTestId("admin-card-field-priority-select")
    .selectOption("blocker");
  await expect(page.getByTestId("admin-card-priority-badge")).toHaveText(
    "blocker",
  );

  // Cover — SET_CARD_COVER through the shared palette CSS.
  await page.getByTestId("admin-card-cover-trigger").click();
  await page.getByTestId("admin-card-cover-color-blue").click();
  await expect(page.getByTestId("admin-card-cover-trigger")).toContainText(
    "Change cover",
  );

  // Labels — one SET_CARD_LABEL command for the toggled label.
  const secondLabel = page.getByTestId(
    `admin-card-label-toggle-${secondLabelId}`,
  );
  await expect(secondLabel).toHaveAttribute("aria-pressed", "false");
  await secondLabel.click();
  await expect(secondLabel).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Label updated")).toBeVisible();

  const labelsHelp = page.getByTestId("admin-card-labels-help");
  await labelsHelp.click();
  await expect(
    page.getByText(
      /Labels save immediately — there is no separate Save button/,
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(labelsHelp).toBeFocused();

  const auditResponse = await admin.get(
    `/api/v1/admin/audit?limit=100&search=${encodeURIComponent(board.id)}`,
  );
  expect(auditResponse.ok(), await auditResponse.text()).toBeTruthy();
  const audit = (await auditResponse.json()) as {
    items: Array<{
      action: string;
      details: Record<string, unknown> | null;
    }>;
  };
  const fieldRows = audit.items.filter(
    (entry) =>
      entry.action === "board.command" &&
      entry.details?.masterEmail === ownerCredentials().email,
  );
  const types = fieldRows.map((entry) => entry.details?.type);
  for (const type of [
    "UPDATE_CARD",
    "SET_CARD_ASSIGN",
    "SET_CARD_DUE_DATE",
    "SET_CARD_PRIORITY",
    "SET_CARD_COVER",
    "SET_CARD_LABEL",
  ]) {
    expect(types).toContain(type);
  }
  const titleRow = fieldRows.find(
    (entry) => entry.details?.type === "UPDATE_CARD",
  );
  const commandId = String(titleRow?.details?.commandId);
  expect(commandId).not.toBe("undefined");
  const commandResponse = await admin.get(
    `/api/v1/admin/commands?commandId=${encodeURIComponent(commandId)}`,
  );
  expect(commandResponse.ok(), await commandResponse.text()).toBeTruthy();
  const commands = (await commandResponse.json()) as {
    total: number;
    items: Array<{ type: string; auditId: string | null }>;
  };
  expect(commands.total).toBe(1);
  expect(commands.items[0]?.type).toBe("UPDATE_CARD");
  expect(commands.items[0]?.auditId).toEqual(expect.any(String));
});

test("C7: the card timeline, fields and audit link stay inside 1440/1024/390", async ({
  page,
  admin,
  board,
}) => {
  const columnId = await board.column(uniqueToken("timeline-column"));
  const cardId = await board.card(columnId, uniqueToken("timeline-card"));
  const suggestionTitle = uniqueToken("timeline-target");
  const suggestionId = await board.card(columnId, suggestionTitle);
  const longLabelId = await board.label(
    `${uniqueToken("lbl")}${"x".repeat(9)}`,
    "red",
  );
  await board.command({
    type: "SET_CARD_LABEL",
    cardId,
    labelId: longLabelId,
    on: true,
  });
  const commandId = randomUUID();
  const command = await admin.post(
    `/api/v1/admin/boards/${board.id}/commands`,
    {
      data: {
        commandId,
        action: {
          type: "UPDATE_CARD",
          cardId,
          description: "Responsive timeline",
          at: Date.now(),
        },
      },
    },
  );
  expect(command.status(), await command.text()).toBe(201);
  await loginAsMaster(page, ownerCredentials());
  await page.goto(adminPath(`cards/${cardId}`), {
    waitUntil: "domcontentloaded",
  });

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1024, height: 768 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByTestId(`admin-card-timeline-audit-command-${commandId}`),
    ).toBeVisible();
    const scroller = page.getByTestId("admin-card-detail-scroll");
    const timeline = page
      .getByTestId("admin-card-detail-timeline")
      .locator("ul");
    const fields = page.getByTestId("admin-card-fields");
    const relations = page.getByTestId("admin-card-relations");
    await expect(fields).toBeVisible();
    await expect(relations).toBeVisible();
    await expect(
      page.getByTestId(`admin-card-label-toggle-${longLabelId}`),
    ).toBeVisible();
    const labelsHelp = page.getByTestId("admin-card-labels-help");
    const helpTriggerBox = await labelsHelp.boundingBox();
    expect(helpTriggerBox?.width ?? 0).toBeGreaterThanOrEqual(24);
    expect(helpTriggerBox?.height ?? 0).toBeGreaterThanOrEqual(24);
    await labelsHelp.click();
    const helpDialog = page.getByRole("dialog", { name: "About labels" });
    await expect(helpDialog).toBeVisible();
    const helpBox = await helpDialog.boundingBox();
    expect(helpBox).not.toBeNull();
    expect(helpBox?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect(helpBox?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((helpBox?.x ?? 0) + (helpBox?.width ?? 0)).toBeLessThanOrEqual(
      viewport.width + 0.1,
    );
    expect((helpBox?.y ?? 0) + (helpBox?.height ?? 0)).toBeLessThanOrEqual(
      viewport.height + 0.1,
    );
    await page.keyboard.press("Escape");
    await expect(helpDialog).toBeHidden();
    await expect(labelsHelp).toBeFocused();
    for (const box of [scroller, timeline, fields, relations]) {
      expect(
        await box.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
    }
    if (viewport.width === 390) {
      await page.getByTestId("admin-card-link-open").click();
      const linkForm = page.getByTestId("admin-card-link-form");
      await expect(linkForm).toBeVisible();
      await page.getByTestId("admin-card-link-target").fill(suggestionTitle);
      await expect(
        page.getByTestId(`admin-card-link-suggestion-${suggestionId}`),
      ).toBeVisible();
      for (const box of [linkForm, relations]) {
        expect(
          await box.evaluate(
            (element) => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true);
      }
    }
  }
});

test("C8: a master edits checklists and links and every change has an audit row", async ({
  page,
  admin,
  board,
}) => {
  const seeded = await seedRichCard(board, { withLink: false });
  const targetTitle = uniqueToken("relation-target");
  const targetId = await board.card(seeded.columnId, targetTitle);
  const incomingTitle = uniqueToken("relation-incoming");
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

  const relations = page.getByTestId("admin-card-relations");
  await expect(relations).toBeVisible();
  await expect(
    page.getByTestId("admin-card-relations-owner-notice"),
  ).toContainText("You are acting as the board owner");

  // Add, rename, item CRUD and delete a checklist.
  const checklistTitle = uniqueToken("browser-checklist");
  await page.getByTestId("admin-new-checklist-title").fill(checklistTitle);
  await page.getByTestId("admin-new-checklist-add").click();
  const checklistLocator = relations
    .locator('[data-testid^="admin-checklist-row-"]')
    .filter({ hasText: checklistTitle })
    .first();
  await expect(checklistLocator).toBeVisible();
  const checklistTestId = await checklistLocator.getAttribute("data-testid");
  const checklistId = String(checklistTestId).replace(
    "admin-checklist-row-",
    "",
  );
  const checklistRow = page.getByTestId(`admin-checklist-row-${checklistId}`);

  await page.getByTestId(`admin-checklist-rename-${checklistId}`).click();
  const renamedTitle = `${checklistTitle}-renamed`;
  await page
    .getByTestId(`admin-checklist-rename-input-${checklistId}`)
    .fill(renamedTitle);
  await page.getByTestId(`admin-checklist-rename-save-${checklistId}`).click();
  await expect(checklistRow).toContainText(renamedTitle);

  const itemText = uniqueToken("browser-item");
  await page
    .getByTestId(`admin-checklist-item-input-${checklistId}`)
    .fill(itemText);
  await page.getByTestId(`admin-checklist-item-add-${checklistId}`).click();
  const itemLocator = checklistRow
    .locator('[data-testid^="admin-checklist-item-row-"]')
    .filter({ hasText: itemText })
    .first();
  await expect(itemLocator).toBeVisible();
  const itemTestId = await itemLocator.getAttribute("data-testid");
  const itemId = String(itemTestId).replace("admin-checklist-item-row-", "");
  const itemRow = page.getByTestId(`admin-checklist-item-row-${itemId}`);
  await itemRow.getByRole("checkbox").click();
  await expect(checklistRow).toContainText("1/1");

  await page.getByTestId(`admin-checklist-item-rename-${itemId}`).click();
  const renamedItem = `${itemText}-renamed`;
  await page
    .getByTestId(`admin-checklist-item-rename-input-${itemId}`)
    .fill(renamedItem);
  await page.getByTestId(`admin-checklist-item-rename-save-${itemId}`).click();
  await expect(itemRow).toContainText(renamedItem);

  await page.getByTestId(`admin-checklist-item-delete-${itemId}`).click();
  await expect(itemRow).toHaveCount(0);

  await page.getByTestId(`admin-checklist-delete-${checklistId}`).click();
  await confirmAction(page);
  await expect(checklistRow).toHaveCount(0);

  // Remove an incoming link through its holder card (the other card).
  const incomingRow = page
    .locator('[data-testid^="admin-card-link-row-"]')
    .filter({ hasText: incomingTitle })
    .first();
  await expect(incomingRow).toBeVisible();
  await incomingRow.locator('[data-testid^="admin-card-link-remove-"]').click();
  await expect(incomingRow).toContainText("Deleted");

  // Add and remove a link through the admin combobox.
  await page.getByTestId("admin-card-link-open").click();
  await page.getByTestId("admin-card-link-target").fill(targetTitle);
  await page
    .locator(`[data-testid="admin-card-link-suggestion-${targetId}"]`)
    .click();
  await page.getByTestId("admin-card-link-add").click();
  const linkRow = page
    .locator('[data-testid^="admin-card-link-row-"]')
    .filter({ hasText: targetTitle })
    .first();
  await expect(linkRow).toBeVisible();
  await linkRow.locator('[data-testid^="admin-card-link-remove-"]').click();
  // The soft-deleted row stays readable (and loses its remove action).
  await expect(
    linkRow.locator('[data-testid^="admin-card-link-remove-"]'),
  ).toHaveCount(0);
  await expect(linkRow).toContainText("Deleted");

  const auditResponse = await admin.get(
    `/api/v1/admin/audit?limit=100&search=${encodeURIComponent(board.id)}`,
  );
  expect(auditResponse.ok(), await auditResponse.text()).toBeTruthy();
  const audit = (await auditResponse.json()) as {
    items: Array<{
      action: string;
      details: Record<string, unknown> | null;
    }>;
  };
  const types = audit.items
    .filter(
      (entry) =>
        entry.action === "board.command" &&
        entry.details?.masterEmail === ownerCredentials().email,
    )
    .map((entry) => entry.details?.type);
  for (const type of [
    "ADD_CHECKLIST",
    "RENAME_CHECKLIST",
    "ADD_CHECKLIST_ITEM",
    "SET_CHECKLIST_ITEM_DONE",
    "RENAME_CHECKLIST_ITEM",
    "DELETE_CHECKLIST_ITEM",
    "DELETE_CHECKLIST",
    "ADD_CARD_LINK",
    "REMOVE_CARD_LINK",
  ]) {
    expect(types).toContain(type);
  }
});
