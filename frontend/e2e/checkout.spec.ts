import { expect, test } from "@playwright/test";
import { paidSlug, randomPhone } from "./helpers";

async function pay(page: import("@playwright/test").Page, phone: string) {
  await page.goto(`/content/${paidSlug}`);
  await page.getByRole("button", { name: /Buy this content/ }).click();
  await page.getByLabel("Mobile money number").fill(phone);
  await page.getByLabel("First name").fill("Neema");
  await page.getByLabel("Last name").fill("Lema");
  await page.getByRole("button", { name: /^Pay TZS/ }).click();
}

test("guest buys, account is auto-created, auto-login, then forced password flow", async ({ page }) => {
  const phone = randomPhone();
  await pay(page, phone);
  await expect(page.getByTestId("checkout-waiting")).toContainText("Check your phone");
  await expect(page.getByTestId("checkout-success")).toContainText("Your account was created", { timeout: 30_000 });
  await expect(page.getByTestId("checkout-success")).toContainText(`255${phone.slice(1)}`);
  await page.getByRole("button", { name: "Start learning" }).click();
  await expect(page.getByTestId("article-body")).toContainText("Common mistakes");
  await expect(page.getByTestId("paywall")).toHaveCount(0);
  await expect(page.getByText("Your password is still your phone number")).toBeVisible();

  await page.getByRole("link", { name: "Change", exact: true }).click();
  await page.getByLabel("New password", { exact: true }).fill("a-private-pass-77");
  await page.getByLabel("Confirm new password").fill("a-private-pass-77");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByText("Your password is still your phone number")).toHaveCount(0);
});

test("logging in with the phone password forces a change first", async ({ page, browser }) => {
  const phone = randomPhone();
  await pay(page, phone);
  await expect(page.getByTestId("checkout-success")).toBeVisible({ timeout: 30_000 });
  const fresh = await (await browser.newContext()).newPage();
  await fresh.goto("/login");
  await fresh.getByLabel("Phone number").fill(phone);
  await fresh.getByLabel("Password").fill(`255${phone.slice(1)}`);
  await fresh.getByRole("button", { name: "Log in" }).click();
  await expect(fresh).toHaveURL(/change-password\?forced=1/);
  await expect(fresh.getByRole("heading", { name: "Set your own password" })).toBeVisible();
  await fresh.goto("/library");
  await expect(fresh).toHaveURL(/change-password/);
});

test("a declined payment shows a clear screen with Try again", async ({ page }) => {
  await pay(page, `0754${String(Math.floor(10 + Math.random() * 89))}0000`);
  await expect(page.getByTestId("checkout-failed")).toContainText("declined", { timeout: 30_000 });
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("button", { name: /^Pay TZS/ })).toBeVisible();
});

test("a double tap on pay makes one order", async ({ page }) => {
  await page.goto(`/content/${paidSlug}`);
  await page.getByRole("button", { name: /Buy this content/ }).click();
  await page.getByLabel("Mobile money number").fill(randomPhone());
  await page.getByLabel("First name").fill("A");
  await page.getByLabel("Last name").fill("B");
  const requests: string[] = [];
  page.on("request", (r) => { if (r.url().endsWith("/checkout/") && r.method() === "POST") requests.push(r.url()); });
  await page.getByRole("button", { name: /^Pay TZS/ }).dblclick();
  await expect(page.getByTestId("checkout-waiting")).toBeVisible();
  expect(requests).toHaveLength(1);
});
