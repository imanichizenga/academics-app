import { expect, test } from "@playwright/test";

test("browse and filter, synced to the URL and back-button safe", async ({ page }) => {
  await page.goto("/explore");
  await expect(page.getByText(/^\d+ results$/)).toBeVisible();
  const total = await page.getByText(/^\d+ results$/).innerText();
  await page.getByRole("button", { name: "Video", exact: true }).first().click();
  await expect(page).toHaveURL(/type=video/);
  await expect(page.getByText(/^3 results/).or(page.getByText(/^[1-9] results?/))).toBeVisible();
  await page.getByLabel("Categories").getByRole("button", { name: /Sciences/ }).click();
  await expect(page).toHaveURL(/category=sciences/);
  await expect(page.getByTestId("content-card")).toHaveCount(1);
  await page.reload();
  await expect(page.getByTestId("content-card")).toHaveCount(1);
  await page.goBack();
  await expect(page).not.toHaveURL(/category=sciences/);
  await expect(page).toHaveURL(/type=video/);
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.getByText(total)).toBeVisible();
});

test("search is debounced and finds body text by prefix", async ({ page }) => {
  await page.goto("/explore");
  await page.getByLabel("Search lessons").fill("kuandika");
  await expect(page).toHaveURL(/q=kuandika/);
  await expect(page.getByTestId("content-card")).toHaveCount(1);
  await expect(page.getByText("Kuandika insha bora").first()).toBeVisible();
});

test("free content needs no login, even for its attached file", async ({ page, context }) => {
  await page.goto("/content/solving-linear-equations-without-fear");
  await expect(page.getByTestId("article-body")).toContainText("Practice");
  await expect(page.getByTestId("paywall")).toHaveCount(0);
  const cookies = await context.cookies();
  expect(cookies.find((c) => c.name === "access")).toBeUndefined();
  const download = page.waitForEvent("download");
  await page.getByText("click here to get your handbook").click();
  expect((await download).suggestedFilename()).toBe("student-handbook.pdf");
});

test("locked content shows a preview and hides the rest", async ({ page }) => {
  const response = await page.goto("/content/writing-a-strong-composition");
  const html = await response!.text();
  expect(html).not.toContain("Common mistakes");
  await expect(page.getByTestId("paywall")).toContainText("Unlock the full lesson");
  await expect(page.getByRole("button", { name: /Buy this content/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Subscribe/ })).toBeVisible();
});
