import { test, expect } from "@/fixtures/board.js";

for (const kind of ["comment", "attachment"] as const) {
  test(`administrative ${kind} deletion remains in admin audit`, async ({
    page,
    board,
    admin,
  }) => {
    const column = await board.column("Todo");
    const card = await board.card(column, "Audit task");
    const created =
      kind === "comment"
        ? await board.api.post(`/api/v1/cards/${card}/comments`, {
            data: { text: "Moderated comment" },
          })
        : await board.api.post(`/api/v1/cards/${card}/attachments`, {
            multipart: {
              file: {
                name: "moderated.txt",
                mimeType: "text/plain",
                buffer: Buffer.from("test"),
              },
            },
          });
    expect(created.ok()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };
    const removed = await admin.delete(
      `/api/v1/admin/${kind === "comment" ? "comments" : "attachments"}/${id}`,
    );
    expect(removed.ok(), await removed.text()).toBeTruthy();
    const audit = await admin.get(`/api/v1/admin/audit?search=${id}`);
    expect(audit.ok()).toBeTruthy();
    const { items } = (await audit.json()) as {
      items: { action: string; targetId: string }[];
    };
    expect(items).toContainEqual(
      expect.objectContaining({ action: `${kind}.delete`, targetId: id }),
    );
    await board.open(page);
    await page
      .getByRole("group", { name: "View", exact: true })
      .getByRole("button", { name: "Watch" })
      .click();
    const feed = page.getByTestId("watch-feed");
    await expect(feed).toContainText(
      kind === "comment" ? "Moderated comment" : "moderated.txt",
    );
    await expect(feed).not.toContainText(
      kind === "comment" ? "Deleted a comment" : "Deleted an attachment",
    );
    const restored = await admin.post(
      `/api/v1/admin/entities/${kind === "comment" ? "comments" : "attachments"}/${id}/restore`,
    );
    expect(restored.ok(), await restored.text()).toBeTruthy();
    const afterRestore = await admin.get(`/api/v1/admin/audit?search=${id}`);
    const restoreAudit = (await afterRestore.json()) as {
      items: { action: string; targetId: string }[];
    };
    expect(restoreAudit.items).toContainEqual(
      expect.objectContaining({ action: "entity.restored", targetId: id }),
    );
  });
}

test("administrator membership changes remain in admin audit", async ({
  page,
  board,
  admin,
  createUser,
}) => {
  await board.column("Todo");
  const member = await createUser();
  const added = await admin.post(`/api/v1/admin/boards/${board.id}/members`, {
    data: { email: member.email, role: "VIEWER" },
  });
  expect(added.ok(), await added.text()).toBeTruthy();
  const meta = await admin.get(`/api/v1/admin/boards/${board.id}/meta`);
  expect(meta.ok()).toBeTruthy();
  const { members } = (await meta.json()) as {
    members: { id: string; userEmail: string }[];
  };
  const membership = members.find((entry) => entry.userEmail === member.email);
  expect(membership).toBeDefined();
  const changed = await admin.patch(
    `/api/v1/admin/boards/${board.id}/members/${membership!.id}`,
    { data: { role: "MEMBER" } },
  );
  expect(changed.ok(), await changed.text()).toBeTruthy();
  const removed = await admin.delete(
    `/api/v1/admin/boards/${board.id}/members/${membership!.id}`,
  );
  expect(removed.ok(), await removed.text()).toBeTruthy();
  const audit = await admin.get(`/api/v1/admin/audit?search=${board.id}`);
  const { items } = (await audit.json()) as {
    items: { action: string; targetId: string }[];
  };
  expect(items).toContainEqual(
    expect.objectContaining({
      action: "board.member_added",
      targetId: board.id,
    }),
  );
  for (const action of ["board.member_role_changed", "board.member_removed"]) {
    expect(items).toContainEqual(
      expect.objectContaining({ action, targetId: board.id }),
    );
  }
  await board.open(page);
  await page
    .getByRole("group", { name: "View", exact: true })
    .getByRole("button", { name: "Watch" })
    .click();
  const feed = page.getByTestId("watch-feed");
  await expect(feed).toContainText("Todo");
  await expect(feed).not.toContainText(member.email);
});
