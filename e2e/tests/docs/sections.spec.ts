import { expect, test } from "@playwright/test";

import { docsUrl, openDocs, sidebar } from "@/helpers/docs.js";

test("opens the docs landing with its five sidebar sections", async ({
  page,
}) => {
  await openDocs(page);

  await expect(page).toHaveURL(docsUrl());
  await expect(page).toHaveTitle(/Documentation/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Documentation" }),
  ).toBeVisible();
  await expect(sidebar(page).locator(".group-label")).toHaveText([
    "Start",
    "User guide",
    "Admin panel",
    "API",
    "Reference",
  ]);
});

const sections = [
  {
    group: "Start",
    link: "Getting started",
    path: "getting-started/",
    heading: "Getting started",
  },
  {
    group: "User guide",
    link: "Boards, columns and cards",
    path: "user-guide/boards/",
    heading: "Boards, columns and cards",
  },
  {
    group: "Admin panel",
    link: "Admin panel",
    path: "admin/",
    heading: "Admin panel",
  },
  {
    group: "API",
    link: "API reference",
    path: "api/",
    heading: "API reference",
  },
  {
    group: "Reference",
    link: "FAQ and troubleshooting",
    path: "faq/",
    heading: "FAQ and troubleshooting",
  },
] as const;

for (const section of sections) {
  test(`opens the ${section.group} section from the sidebar`, async ({
    page,
  }) => {
    await openDocs(page);

    await sidebar(page)
      .getByRole("link", { name: section.link, exact: true })
      .click();

    await expect(page).toHaveURL(docsUrl(section.path));
    await expect(
      page.getByRole("heading", { level: 1, name: section.heading }),
    ).toBeVisible();
  });
}
