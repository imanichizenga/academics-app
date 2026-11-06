import { expect, test } from "@playwright/test";

test("mobile: bottom tabs, filter sheet with live count, no sideways scroll", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
  await page.getByRole("button", { name: /Filters/ }).click();
  await page.getByRole("button", { name: "Video", exact: true }).first().click();
  const apply = page.getByRole("button", { name: /Apply \(\d+ results\)/ });
  await expect(apply).toBeVisible();
  await apply.click();
  await expect(page).toHaveURL(/type=video/);
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(scroll).toBeLessThanOrEqual(0);
});

test("mobile: detail page has a back button", async ({ page }) => {
  await page.goto("/explore");
  await page.getByTestId("content-card").first().click();
  await page.getByRole("button", { name: "Go back" }).click();
  await expect(page).toHaveURL(/\/explore/);
});
