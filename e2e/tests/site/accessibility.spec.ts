import { expect, test } from "@playwright/test";

import { sitePage } from "@/helpers/urls.js";

/**
 * Keyboard and landmark basics on the marketing shell: the skip link is the
 * first stop, there is exactly one main/heading, focus rings are visible and
 * heading levels do not skip. No account is needed.
 */

test("exposes a skip link, landmarks and visible keyboard focus", async ({
  page,
}) => {
  await page.goto(sitePage("/"));

  await page.keyboard.press("Tab");
  const skip = page.locator(".skip-link");
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  expect(
    await skip.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");

  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);

  await expect(page.getByRole("main")).toHaveCount(1);
  await expect(page.getByRole("banner")).toHaveCount(1);
  await expect(page.getByRole("contentinfo")).toHaveCount(1);
  await expect(page.getByRole("navigation")).toHaveCount(1);
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

  const levels = await page
    .locator("h1, h2, h3, h4, h5, h6")
    .evaluateAll((headings) =>
      headings.map((heading) => Number(heading.tagName.slice(1))),
    );
  expect(levels[0]).toBe(1);
  for (const [index, level] of levels.entries()) {
    if (index === 0) continue;
    expect(level - levels[index - 1]).toBeLessThanOrEqual(1);
  }

  await page.reload();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  const brand = page.getByRole("banner").getByRole("link", {
    name: "Janosik",
    exact: true,
  });
  await expect(brand).toBeFocused();
  expect(
    await brand.evaluate((element) => ({
      focusVisible: element.matches(":focus-visible"),
      outline: getComputedStyle(element).outlineStyle,
    })),
  ).toEqual({ focusVisible: true, outline: "solid" });
});
