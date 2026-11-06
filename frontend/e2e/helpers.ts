import type { Page } from "@playwright/test";

export const ADMIN = { phone: "0754000001", password: "darasa-demo-2026" };
export const randomPhone = () => `0754${String(Math.floor(100000 + Math.random() * 899999))}`;
export async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}
export const paidSlug = "electricity-at-home-explained";
