import { test, expect } from "@/fixtures/collaboration.js";
import { memberRow, openMembers } from "@/helpers/collaboration.js";

test.describe.configure({ timeout: 60_000 });

test("an accepted invitation appears in an already open member list", async ({
  page,
  board,
  partner,
}) => {
  await board.open(page);
  const dialog = await openMembers(page);
  await expect(
    dialog.getByRole("heading", { name: "Members (1)" }),
  ).toBeVisible();

  await partner.invite("MEMBER");
  await partner.accept();

  await expect(memberRow(page, partner.user.email)).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    dialog.getByRole("heading", { name: "Members (2)" }),
  ).toBeVisible();
  await expect(memberRow(page, partner.user.email)).toHaveAttribute(
    "data-role",
    "MEMBER",
  );
});
