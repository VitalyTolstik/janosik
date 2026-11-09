import { randomUUID } from "node:crypto";
import { test, expect } from "@/fixtures/member.js";
import { createExtraBoard } from "@/helpers/boards.js";
import { newSession } from "@/helpers/account.js";

test("groups shared boards and hides admin-only actions", async ({
  page,
  browser,
  testIp,
  board,
  member,
}) => {
  const memberBoard = await createExtraBoard(
    member.api,
    `Member board ${randomUUID()}`,
  );
  const viewerBoard = await createExtraBoard(
    member.api,
    `Viewer board ${randomUUID()}`,
  );
  for (const [target, role] of [
    [memberBoard.id, "MEMBER"],
    [viewerBoard.id, "VIEWER"],
  ] as const) {
    const invited = await member.api.post(`/api/v1/boards/${target}/members`, {
      data: { email: board.email, role },
    });
    expect(invited.status()).toBe(201);
  }
  const invitations = await board.api.get("/api/v1/invitations");
  expect(invitations.ok()).toBeTruthy();
  const pending = (await invitations.json()) as {
    id: string;
    boardId: string;
  }[];
  for (const target of [memberBoard.id, viewerBoard.id]) {
    const invitation = pending.find((item) => item.boardId === target);
    expect(invitation).toBeDefined();
    const accepted = await board.api.post(
      `/api/v1/invitations/${invitation!.id}/accept`,
    );
    expect(accepted.ok()).toBeTruthy();
  }

  await board.open(page);
  await page.getByRole("button", { name: "Switch board" }).click();
  await expect(page.getByTestId("board-group-mine")).toBeVisible();
  await expect(page.getByTestId("board-group-shared")).toBeVisible();

  const mine = page.getByRole("option").filter({ hasText: board.title });
  await expect(mine.getByRole("button", { name: "Archive board" })).toHaveCount(
    1,
  );

  const memberRow = page
    .getByRole("option")
    .filter({ hasText: memberBoard.title });
  await expect(memberRow.getByTestId("board-role")).toHaveAttribute(
    "aria-label",
    "Member — can edit",
  );
  await expect(
    memberRow.getByRole("button", { name: "Archive board" }),
  ).toHaveCount(0);

  const viewerRow = page
    .getByRole("option")
    .filter({ hasText: viewerBoard.title });
  await expect(viewerRow.getByTestId("board-role")).toHaveAttribute(
    "aria-label",
    "Viewer — view only",
  );
  await expect(
    viewerRow.getByRole("button", { name: "Archive board" }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");

  // The partner sees the original board in their own shared group and the
  // member role icon, so a missing archive action reads as an access level.
  const partner = await newSession(browser, member.user, testIp);
  try {
    await partner.page.getByRole("button", { name: "Switch board" }).click();
    await expect(partner.page.getByTestId("board-group-shared")).toBeVisible();
    const shared = partner.page
      .getByRole("option")
      .filter({ hasText: board.title });
    await expect(shared.getByTestId("board-role")).toHaveAttribute(
      "aria-label",
      "Member — can edit",
    );
  } finally {
    await partner.context.close();
  }
});
