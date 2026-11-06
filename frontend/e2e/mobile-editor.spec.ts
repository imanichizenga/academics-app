import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./helpers";

test("mobile: select text, attach a PDF from the library, and the student sees the link", async ({ page, browser }) => {
  const title = `Mobile attach ${Date.now()}`;
  await login(page, ADMIN.phone, ADMIN.password);
  await expect(page).toHaveURL(/\/admin/);
  await page.goto("/admin/contents/new");
  await expect(page).toHaveURL(/\/admin\/contents\/[0-9a-f-]{36}/);
  await page.getByLabel("Title", { exact: true }).fill(title);
  const body = page.getByLabel("Lesson body");
  await body.click();
  const words = "click here to get your book";
  await page.keyboard.type(`Please ${words}`);
  for (let i = 0; i < words.length; i++) await page.keyboard.press("Shift+ArrowLeft");

  const bar = page.getByTestId("selection-bar");
  await expect(bar).toBeVisible();
  await expect(page.getByTestId("bubble-menu")).toHaveCount(0);
  const attach = bar.getByRole("button", { name: "Attach file" });
  const box = (await attach.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.screenshot({ path: "../screenshots/editor-mobile-selection.png" });

  await attach.click();
  await expect(page.getByRole("dialog")).toContainText(`Attach a file to “${words}”`);
  await page.getByRole("tab", { name: "Media library" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /PDF ·/ }).first().click();
  await expect(body.locator("a.file-link")).toHaveText(words);
  await expect(page.getByTestId("save-status")).toContainText("Saved", { timeout: 15_000 });
  await page.screenshot({ path: "../screenshots/editor-mobile-attached.png" });

  await page.getByRole("button", { name: "Publish" }).first().click();
  await expect(page.getByText("published", { exact: true }).first()).toBeVisible();
  const slug = title.toLowerCase().replace(/ /g, "-");
  const student = await (await browser.newContext({ ...{ viewport: { width: 412, height: 839 }, isMobile: true, hasTouch: true } })).newPage();
  await student.goto(`/content/${slug}`);
  await expect(student.locator("a.file-link")).toHaveText(words);
  await student.screenshot({ path: "../screenshots/student-mobile-file-link.png" });
});

test.describe("desktop bubble", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });
  test("never covers the toolbar, in flow or stuck", async ({ page }) => {
    await login(page, ADMIN.phone, ADMIN.password);
    await expect(page).toHaveURL(/\/admin/);
    await page.goto("/admin/contents/new");
    await expect(page).toHaveURL(/\/admin\/contents\/[0-9a-f-]{36}/);
    await page.getByLabel("Lesson body").click();
    const overlap = async () => {
      const bar = (await page.getByRole("toolbar", { name: "Formatting" }).boundingBox())!;
      const bubble = (await page.getByTestId("bubble-menu").boundingBox())!;
      return bubble.y < bar.y + bar.height && bubble.y + bubble.height > bar.y;
    };
    await page.keyboard.type("First line of the lesson");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
    await expect(page.getByTestId("bubble-menu")).toBeVisible();
    await page.waitForTimeout(300);
    expect(await overlap()).toBe(false);
    await page.keyboard.press("End");
    for (let i = 0; i < 40; i++) await page.keyboard.press("Enter");
    await page.keyboard.type("A line far down the page");
    for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.waitForTimeout(300);
    expect(await overlap()).toBe(false);
  });
});
