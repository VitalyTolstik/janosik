import { expect, test } from "@/fixtures/account.js";
import { docsUrl } from "@/helpers/docs.js";

test("opens the documentation from the app Help menu", async ({
  page,
  account,
}) => {
  await account.open(page);

  await page.getByTestId("help-trigger").click();
  const docsLink = page.getByTestId("help-docs");
  await expect(docsLink).toHaveAttribute("href", new URL(docsUrl()).pathname);

  const [docsPage] = await Promise.all([
    page.waitForEvent("popup"),
    docsLink.click(),
  ]);

  await expect(docsPage).toHaveURL(docsUrl());
  await expect(
    docsPage.getByRole("heading", { level: 1, name: "Documentation" }),
  ).toBeVisible();
});
