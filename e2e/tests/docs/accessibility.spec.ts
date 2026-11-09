import { expect, test } from "@playwright/test";

import { openDocs, searchButton } from "@/helpers/docs.js";

/**
 * Docs keyboard/landmark basics: the Starlight skip link is first, the page
 * has one main landmark and a named sidebar navigation, and focus rings stay
 * visible while tabbing into the sidebar.
 */

test("exposes a skip link, landmarks and visible focus in the docs", async ({
  page,
}) => {
  await openDocs(page);

  await page.keyboard.press("Tab");
  const skip = page.locator(".sl-skip-link");
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  expect(
    await skip.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");

  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("navigation", { name: "Main" })).toHaveCount(1);
  await expect(searchButton(page)).toHaveAccessibleName("Search the docs");

  let focused = "";
  for (let index = 0; index < 15 && focused !== "Getting started"; index++) {
    await page.keyboard.press("Tab");
    focused = await page.evaluate(() =>
      (document.activeElement?.textContent ?? "").trim(),
    );
  }
  expect(focused).toBe("Getting started");

  const style = await page.evaluate(() => ({
    focusVisible: document.activeElement?.matches(":focus-visible") ?? false,
    outline: document.activeElement
      ? getComputedStyle(document.activeElement).outlineStyle
      : "none",
  }));
  expect(style.focusVisible).toBe(true);
  expect(style.outline).not.toBe("none");
});
