import { randomUUID } from "node:crypto";
import { expect, type APIRequestContext } from "@playwright/test";

/**
 * Data seeding for the master-panel suites. Everything is prepared through the
 * user API (commands/REST), never by driving the UI under test, so a test can
 * jump straight to the one screen it verifies.
 */

export interface CommandSource {
  command: (action: Record<string, unknown>) => Promise<void>;
}

export interface SeedBoard extends CommandSource {
  id: string;
  title: string;
  api: APIRequestContext;
  userId: string;
  email: string;
  column: (title: string) => Promise<string>;
  card: (columnId: string, title: string) => Promise<string>;
  label: (name: string, color?: string) => Promise<string>;
}

export interface RichCard {
  columnId: string;
  cardId: string;
  title: string;
  description: string;
  labelId: string;
  checklistId: string;
  checklistTitle: string;
  itemIds: [string, string];
  itemTexts: [string, string];
  otherCardId: string;
  otherCardTitle: string;
  linkId: string;
  attachmentId: string;
  fileName: string;
  commentId: string;
  commentText: string;
  dueDate: number;
}

export async function addComment(
  api: APIRequestContext,
  cardId: string,
  text: string,
): Promise<string> {
  const response = await api.post(`/api/v1/cards/${cardId}/comments`, {
    data: { text },
  });
  expect(
    response.status(),
    `comment: ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

export async function addAttachment(
  api: APIRequestContext,
  cardId: string,
  fileName: string,
  contents = "janosik e2e attachment",
): Promise<string> {
  const response = await api.post(`/api/v1/cards/${cardId}/attachments`, {
    multipart: {
      file: {
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from(contents),
      },
    },
  });
  expect(
    response.status(),
    `attachment: ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

export async function createApiToken(
  api: APIRequestContext,
  name: string,
): Promise<{ id: string; token: string }> {
  const response = await api.post("/api/v1/users/me/tokens", {
    data: { name, expiresAt: null },
  });
  expect(
    response.status(),
    `token: ${response.status()} ${await response.text()}`,
  ).toBe(201);
  const body = (await response.json()) as {
    token: string;
    apiToken: { id: string };
  };
  return { id: body.apiToken.id, token: body.token };
}

export async function createShare(
  api: APIRequestContext,
  boardId: string,
  mode: "live" | "snapshot",
): Promise<{ id: string; token: string; mode: string }> {
  const response = await api.post(`/api/v1/boards/${boardId}/shares`, {
    data: { mode },
  });
  expect(
    response.status(),
    `share: ${response.status()} ${await response.text()}`,
  ).toBe(201);
  return (await response.json()) as {
    id: string;
    token: string;
    mode: string;
  };
}

/**
 * One card with the full support graph: description, label, checklist,
 * outgoing + incoming links, attachment, comment, priority, assignee and due
 * date. Returns every id so tests can assert on the exact rows they created.
 */
export async function seedRichCard(
  board: SeedBoard,
  options: { title?: string; withLink?: boolean } = {},
): Promise<RichCard> {
  const token = randomUUID();
  const title = options.title ?? `Rich card ${token}`;
  const description = `Description ${token}\nsecond line`;
  const columnId = await board.column(`Column ${token}`);
  const cardId = await board.card(columnId, title);
  const labelId = await board.label(`Label ${token}`, "red");
  const checklistId = randomUUID();
  const checklistTitle = `Checklist ${token}`;
  const itemIds: [string, string] = [randomUUID(), randomUUID()];
  const itemTexts: [string, string] = [
    `First step ${token}`,
    `Second step ${token}`,
  ];
  const otherCardTitle = `Linked card ${token}`;
  const otherCardId = await board.card(columnId, otherCardTitle);
  const linkId = randomUUID();
  const dueDate = Date.now() + 86_400_000;

  await board.command({
    type: "UPDATE_CARD",
    cardId,
    title,
    description,
  });
  await board.command({
    type: "SET_CARD_LABEL",
    cardId,
    labelId,
    on: true,
  });
  await board.command({
    type: "ADD_CHECKLIST",
    cardId,
    newChecklistId: checklistId,
    title: checklistTitle,
  });
  await board.command({
    type: "ADD_CHECKLIST_ITEM",
    cardId,
    checklistId,
    newItemId: itemIds[0],
    text: itemTexts[0],
  });
  await board.command({
    type: "ADD_CHECKLIST_ITEM",
    cardId,
    checklistId,
    newItemId: itemIds[1],
    text: itemTexts[1],
  });
  await board.command({
    type: "SET_CHECKLIST_ITEM_DONE",
    cardId,
    checklistId,
    itemId: itemIds[0],
    done: true,
  });
  await board.command({
    type: "SET_CARD_PRIORITY",
    cardId,
    priority: "high",
  });
  await board.command({
    type: "SET_CARD_ASSIGN",
    cardId,
    assigneeId: board.userId,
  });
  await board.command({
    type: "SET_CARD_DUE_DATE",
    cardId,
    dueDate,
  });
  if (options.withLink !== false) {
    await board.command({
      type: "ADD_CARD_LINK",
      cardId,
      linkId,
      targetCardId: otherCardId,
      linkType: "blocks",
    });
  }
  const commentText = `Moderation target ${token}`;
  const commentId = await addComment(board.api, cardId, commentText);
  const fileName = `attachment-${token}.txt`;
  const attachmentId = await addAttachment(board.api, cardId, fileName);
  return {
    columnId,
    cardId,
    title,
    description,
    labelId,
    checklistId,
    checklistTitle,
    itemIds,
    itemTexts,
    otherCardId,
    otherCardTitle,
    linkId,
    attachmentId,
    fileName,
    commentId,
    commentText,
    dueDate,
  };
}

/** Archive/soft-delete helpers through the user command log. */
export async function archiveCard(
  board: CommandSource,
  cardId: string,
): Promise<void> {
  await board.command({ type: "ARCHIVE_CARD", cardId });
}

export async function archiveBoard(board: CommandSource): Promise<void> {
  await board.command({ type: "ARCHIVE_BOARD" });
}

/** Add many cards to produce a deterministic command-log page count. */
export async function seedCards(
  board: SeedBoard,
  columnId: string,
  count: number,
  prefix: string,
): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(await board.card(columnId, `${prefix} ${index + 1}`));
  }
  return ids;
}
