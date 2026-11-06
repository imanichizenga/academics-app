import { expect, test } from "@playwright/test";
import { ADMIN, LAPSED, SUBSCRIBER, adminApi, login, paidSlug } from "./helpers";

const lesson = `/content/${paidSlug}`;

test("a returning subscriber logs in from the paywall and lands on the unlocked lesson", async ({ page }) => {
  await page.goto(lesson);
  await page.getByRole("link", { name: "Already paid? Log in" }).click();
  await expect(page).toHaveURL(/\/login\?next=/);
  await page.getByLabel("Phone number").fill(SUBSCRIBER.phone);
  await page.getByLabel("Password", { exact: true }).fill(SUBSCRIBER.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(new RegExp(`${lesson}$`));
  await expect(page.getByTestId("paywall")).toHaveCount(0);
  await expect(page.getByText("Unlocked").first()).toBeVisible();
});

test("the pricing page has the same way back in, and login refuses off-site next links", async ({ page }) => {
  await page.goto("/pricing");
  await expect(page.getByRole("link", { name: "Already paid? Log in" })).toHaveAttribute("href", /next=%2Fpricing/);
  await page.goto("/login?next=//evil.example");
  await page.getByLabel("Phone number").fill(SUBSCRIBER.phone);
  await page.getByLabel("Password", { exact: true }).fill(SUBSCRIBER.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/localhost:\d+\/library/);
});

test("an expired subscriber can renew, or buy one lesson, or compare plans", async ({ page }) => {
  await login(page, LAPSED.phone, LAPSED.password);
  await expect(page).toHaveURL(/\/library/);
  await page.goto(lesson);
  const wall = page.getByTestId("paywall");
  await expect(wall).toContainText("Your subscription has ended");
  await expect(wall.getByRole("button", { name: "Renew subscription" })).toBeVisible();
  await expect(wall.getByRole("button", { name: /Buy this lesson only — TZS/ })).toBeVisible();
  await expect(wall.getByRole("link", { name: "Compare plans" })).toHaveAttribute("href", "/pricing");
  await wall.getByRole("button", { name: /Buy this lesson only/ }).click();
  await expect(page.getByRole("button", { name: /^Pay TZS/ })).toBeVisible();
});

test("password fields can be shown", async ({ page }) => {
  await page.goto("/login");
  const field = page.getByLabel("Password", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  const toggle = page.getByRole("button", { name: "Show password" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(field).toHaveAttribute("type", "text");
  await expect(page.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true");
});

test("maintenance hides the site from students, but never from the teacher", async ({ page, browser, baseURL }) => {
  const admin = await adminApi(baseURL!);
  const student = await (await browser.newContext()).newPage();
  try {
    await admin.patch("/api/v1/admin/settings/site/", { maintenance_mode: true, maintenance_message: "Back at noon." });
    await expect(async () => {
      await student.goto("/");
      await expect(student.getByTestId("maintenance")).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 30_000 });
    await expect(student.getByTestId("maintenance")).toContainText("Back at noon.");
    expect((await student.request.get("/api/v1/catalog/home/")).status()).toBe(503);
    await student.goto("/forgot");
    await expect(student.getByTestId("maintenance")).toHaveCount(0);

    await login(page, ADMIN.phone, ADMIN.password);
    await expect(page).toHaveURL(/\/admin/);
    await page.goto(lesson);
    await expect(page.getByTestId("maintenance-banner")).toContainText("Students see the maintenance page");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("We will be right back");
    await page.goto("/");
    await expect(page.getByTestId("content-card").first()).toBeVisible();
  } finally {
    await admin.patch("/api/v1/admin/settings/site/", { maintenance_mode: false, maintenance_message: "" });
    await admin.api.dispose();
  }
  await expect(async () => {
    await student.goto("/");
    await expect(student.getByTestId("maintenance")).toHaveCount(0, { timeout: 2000 });
  }).toPass({ timeout: 30_000 });
});

test("carousel buttons scroll, and stop at the ends", async ({ page }) => {
  await page.goto("/");
  const row = page.getByRole("group", { name: "Featured" });
  const back = row.getByRole("button", { name: "Previous" });
  const next = row.getByRole("button", { name: "Next" });
  await expect(back).toBeDisabled();
  await next.click();
  await expect(back).toBeEnabled();
  await expect(async () => {
    expect(await row.getByTestId("carousel").evaluate((el) => el.scrollLeft)).toBeGreaterThan(50);
  }).toPass();
});

test("the home page introduces the teacher, and each lesson ends with a card", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Meet your teacher" })).toBeVisible();
  await expect(page.getByTestId("teacher")).toContainText("Mwalimu Amani");
  await page.goto(lesson);
  await expect(page.getByTestId("author-card")).toContainText("Mwalimu Amani");
});

test("the interface switches to Kiswahili and keeps it", async ({ page }) => {
  await page.goto("/pricing");
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitem", { name: "Kiswahili" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Jifunze kila kitu, kwa bei moja rahisi");
  await page.goto(lesson);
  await expect(page.getByTestId("paywall")).toContainText("Fungua somo lote");
  await expect(page.locator("html")).toHaveAttribute("lang", "sw");
  await page.goto("/login");
  await page.getByLabel("Namba ya simu").fill("0754999999");
  await page.getByLabel("Nenosiri", { exact: true }).fill("nope");
  await page.getByRole("button", { name: "Ingia" }).click();
  await expect(page.getByText("Namba ya simu au nenosiri si sahihi.")).toBeVisible();
});

test("the lesson column is centred with one left edge when there is no table of contents", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(lesson);
  await expect(page.getByTestId("paywall")).toBeVisible();
  const box = async (locator: import("@playwright/test").Locator) => (await locator.boundingBox())!;
  const title = await box(page.getByRole("heading", { level: 1 }));
  const wall = await box(page.getByTestId("paywall"));
  expect(wall.x).toBeCloseTo(title.x, 0);
  expect(wall.width).toBeCloseTo(672, 0);
  expect(Math.abs(wall.x + wall.width / 2 - 720)).toBeLessThan(10);
});
