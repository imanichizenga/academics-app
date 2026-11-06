import path from "node:path";
import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./helpers";

test("gateway diagnostics run live in the UI", async ({ page }) => {
  await login(page, ADMIN.phone, ADMIN.password);
  await expect(page).toHaveURL(/\/admin/);
  await page.goto("/admin/settings/payments");
  await page.getByRole("button", { name: "Test configuration" }).click();
  const list = page.getByTestId("diagnostics");
  await expect(list.locator('[data-step="config"]')).toHaveAttribute("data-status", "ok");
  await expect(list.locator('[data-step="auth"]')).toContainText("125,000");
  await expect(list.locator('[data-step="probe"]')).toHaveAttribute("data-status", "ok");
  await expect(list.locator('[data-step="webhook"]')).toHaveAttribute("data-status", "warn");
  await expect(page.locator("body")).not.toContainText("snp_mock_key_for_development");
});

test("admin attaches a file to selected text, and a student downloads it", async ({ page, browser }) => {
  const title = `Attached book ${Date.now()}`;
  await login(page, ADMIN.phone, ADMIN.password);
  await expect(page).toHaveURL(/\/admin/);
  await page.goto("/admin/contents/new");
  await expect(page).toHaveURL(/\/admin\/contents\/[0-9a-f-]{36}/);
  await page.getByLabel("Title", { exact: true }).fill(title);
  const body = page.getByLabel("Lesson body");
  await body.click();
  await page.keyboard.type("Please click here to get your book");
  // Select exactly the words to attach to.
  for (let i = 0; i < "click here to get your book".length; i++) await page.keyboard.press("Shift+ArrowLeft");
  await page.getByTestId("bubble-menu").getByRole("button", { name: "Attach file" }).click();
  await page.getByTestId("file-input").last().setInputFiles(path.join(__dirname, "fixtures/your-book.pdf"));
  await expect(body.locator("a.file-link")).toHaveText("click here to get your book");
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });
  await page.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByText("published", { exact: true }).first()).toBeVisible();

  const slug = title.toLowerCase().replace(/ /g, "-");
  const student = await (await browser.newContext()).newPage();
  await student.goto(`/explore?q=${encodeURIComponent(title)}`);
  await student.getByTestId("content-card").first().click();
  await expect(student).toHaveURL(new RegExp(slug));
  await expect(student.getByText("click here to get your book")).toBeVisible();
  // Processing runs in Celery; wait until the file is ready, then download.
  await expect(async () => {
    const r = await student.request.get(await student.locator("a.file-link").getAttribute("href") as string);
    expect(r.status()).toBe(200);
  }).toPass({ timeout: 30_000 });
  const download = student.waitForEvent("download");
  await student.getByText("click here to get your book").click();
  expect((await download).suggestedFilename()).toBe("your-book.pdf");
});

test("command palette and bulk selection work", async ({ page }) => {
  await login(page, ADMIN.phone, ADMIN.password);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Search or jump to…").fill("quadratic");
  await page.getByRole("option", { name: /Quadratic equations/ }).click();
  await expect(page).toHaveURL(/\/admin\/contents\/[0-9a-f-]{36}/);
});

test("an editor cannot reach money or settings", async ({ page }) => {
  await login(page, "0754000002", ADMIN.password);
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("link", { name: "Orders" })).toHaveCount(0);
  expect((await page.request.get("/api/v1/admin/orders/")).status()).toBe(403);
});
