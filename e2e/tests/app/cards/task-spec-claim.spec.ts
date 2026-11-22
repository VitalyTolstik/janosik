import { test, expect } from "../../../fixtures/collaboration.js";
import {
  createAgentSession,
  readAgentSession,
} from "../../../helpers/agents.js";

/**
 * TASK-177.4 (G-03): the card dialog is no longer a read-only window onto an
 * agent-owned card. A human can edit/clear the task contract, see the claim
 * lease, and release it — without ending the agent session. The MCP DoD gate
 * reads the same saved contract (covered in mcp/src/server.test.ts).
 */
test("an agent contract survives a human edit and the claim releases without ending the session", async ({
  page,
  board,
  playwright,
  testIp,
}) => {
  const todo = await board.column("Todo");
  await board.column("Done");
  const cardId = await board.card(todo, "Agent-owned card");
  const agent = await createAgentSession(playwright, board, testIp, {
    sessionName: "Task contract agent",
    currentCardId: cardId,
  });

  try {
    await agent.command({
      type: "SET_CARD_TASK_SPEC",
      cardId,
      acceptanceCriteria: ["agent criterion"],
      definitionOfDone: ["agent done"],
    });
    await agent.command({
      type: "CLAIM_CARD",
      cardId,
      claimedBy: board.userId,
      leaseUntil: Date.now() + 900_000,
    });

    await board.open(page);
    await page
      .getByTestId("card-title")
      .filter({ hasText: "Agent-owned card" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Card details" });

    await expect(dialog.getByTestId("card-task-spec-acceptance")).toContainText(
      "agent criterion",
    );
    await expect(dialog.getByTestId("card-task-spec-done")).toContainText(
      "agent done",
    );
    await expect(dialog.getByTestId("card-claim")).toContainText("Claimed by");
    await expect(dialog.getByTestId("card-claim-release")).toBeVisible();

    // Human edit: Escape must not close the dialog or discard the draft.
    await dialog.getByTestId("card-task-spec-edit").click();
    await dialog
      .getByTestId("card-task-spec-criteria-input")
      .fill("draft survives escape");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId("card-task-spec-form")).toBeVisible();
    await expect(
      dialog.getByTestId("card-task-spec-criteria-input"),
    ).toHaveValue("draft survives escape");

    await dialog
      .getByTestId("card-task-spec-criteria-input")
      .fill("human criterion");
    await dialog.getByTestId("card-task-spec-done-input").fill("human done");
    const saveCommand = page.waitForResponse(
      (response) =>
        response.url().includes(`/boards/${board.id}/commands`) &&
        response.request().method() === "POST",
    );
    await dialog.getByTestId("card-task-spec-save").click();
    expect((await saveCommand).ok()).toBeTruthy();

    await expect(dialog.getByTestId("card-task-spec-acceptance")).toContainText(
      "human criterion",
    );
    await expect(dialog.getByTestId("card-task-spec-done")).toContainText(
      "human done",
    );

    const saved = await board.api.get(`/api/v1/boards/${board.id}`);
    expect(saved.ok()).toBeTruthy();
    const savedBoard = (await saved.json()) as {
      cards: Record<
        string,
        { acceptanceCriteria?: string[]; definitionOfDone?: string[] }
      >;
    };
    expect(savedBoard.cards[cardId]?.acceptanceCriteria).toEqual([
      "human criterion",
    ]);
    expect(savedBoard.cards[cardId]?.definitionOfDone).toEqual(["human done"]);

    // Release with confirmation: the claim goes, the agent session stays.
    await dialog.getByTestId("card-claim-release").click();
    const releaseDialog = page.getByRole("dialog", {
      name: "Release this claim?",
    });
    await expect(releaseDialog).toContainText(
      "This does not end the agent session",
    );
    await releaseDialog
      .getByRole("button", { name: "Release claim", exact: true })
      .click();
    await expect(dialog.getByTestId("card-claim")).toHaveCount(0);
    await expect(dialog.getByTestId("card-task-spec-edit")).toBeFocused();

    const session = await readAgentSession(
      board.api,
      board.id,
      agent.session.id,
    );
    expect(session.endedAt).toBeNull();

    // Clear with confirmation: the next agent sees no contract at all.
    await dialog.getByTestId("card-task-spec-clear").click();
    const clearDialog = page.getByRole("dialog", {
      name: "Clear the task spec?",
    });
    const clearCommand = page.waitForResponse(
      (response) =>
        response.url().includes(`/boards/${board.id}/commands`) &&
        response.request().method() === "POST",
    );
    await clearDialog
      .getByRole("button", { name: "Clear", exact: true })
      .click();
    expect((await clearCommand).ok()).toBeTruthy();
    await expect(dialog.getByTestId("card-task-spec-empty")).toBeVisible();
    await expect(dialog.getByTestId("card-task-spec-edit")).toBeFocused();

    const cleared = await board.api.get(`/api/v1/boards/${board.id}`);
    expect(cleared.ok()).toBeTruthy();
    const clearedBoard = (await cleared.json()) as {
      cards: Record<string, { acceptanceCriteria?: string[] }>;
    };
    expect(clearedBoard.cards[cardId]?.acceptanceCriteria).toBeUndefined();
  } finally {
    await agent.dispose();
  }
});

test("releasing while the spec editor is open keeps the draft and moves focus to the section", async ({
  page,
  board,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Editing release card");
  await board.command({
    type: "SET_CARD_TASK_SPEC",
    cardId,
    acceptanceCriteria: ["draft target"],
    definitionOfDone: ["stay open"],
  });
  await board.command({
    type: "CLAIM_CARD",
    cardId,
    claimedBy: board.userId,
    leaseUntil: Date.now() + 900_000,
  });

  await board.open(page);
  await page
    .getByTestId("card-title")
    .filter({ hasText: "Editing release card" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Card details" });
  await dialog.getByTestId("card-task-spec-edit").click();
  await dialog
    .getByTestId("card-task-spec-criteria-input")
    .fill("draft survives release");

  await dialog.getByTestId("card-claim-release").click();
  const releaseDialog = page.getByRole("dialog", {
    name: "Release this claim?",
  });
  await releaseDialog
    .getByRole("button", { name: "Release claim", exact: true })
    .click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("card-task-spec-form")).toBeVisible();
  await expect(dialog.getByTestId("card-task-spec-criteria-input")).toHaveValue(
    "draft survives release",
  );
  await expect(dialog.getByTestId("card-task-spec")).toBeFocused();
  await expect(dialog.getByTestId("card-claim")).toHaveCount(0);
});

test("a MEMBER sees the claim but a non-owner gets no release control", async ({
  board,
  partner,
  partnerBrowser,
}) => {
  const todo = await board.column("Todo");
  const cardId = await board.card(todo, "Owner-claimed card");
  await board.command({
    type: "CLAIM_CARD",
    cardId,
    claimedBy: board.userId,
    leaseUntil: Date.now() + 900_000,
  });

  await partner.invite("MEMBER");
  await partner.accept();
  await partner.openBoard(partnerBrowser.page);

  await partnerBrowser.page
    .getByTestId("card-title")
    .filter({ hasText: "Owner-claimed card" })
    .click();
  const dialog = partnerBrowser.page.getByRole("dialog", {
    name: "Card details",
  });
  await expect(dialog.getByTestId("card-claim")).toContainText("Claimed by");
  await expect(dialog.getByTestId("card-claim-release")).toHaveCount(0);
  // The owner's card is still claimed.
  const current = await board.api.get(`/api/v1/boards/${board.id}`);
  expect(current.ok()).toBeTruthy();
  const currentBoard = (await current.json()) as {
    cards: Record<string, { claimedBy?: string }>;
  };
  expect(currentBoard.cards[cardId]?.claimedBy).toBe(board.userId);
});
