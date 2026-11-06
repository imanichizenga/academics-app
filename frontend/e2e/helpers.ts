import { request as playwrightRequest, type Page } from "@playwright/test";

export const ADMIN = { phone: "0754000001", password: "darasa-demo-2026" };
export const SUBSCRIBER = { phone: "0754200001", password: "darasa-demo-2026" };
export const LAPSED = { phone: "0754200002", password: "darasa-demo-2026" };
export const randomPhone = () => `0754${String(Math.floor(100000 + Math.random() * 899999))}`;
export async function login(page: Page, phone: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}
export const paidSlug = "electricity-at-home-explained";

/** Sends an admin PATCH from a page-independent session, so tests can flip site settings. */
export async function adminApi(baseURL: string) {
  const api = await playwrightRequest.newContext({ baseURL });
  await api.post("/api/v1/auth/login/", { data: { phone: "255754000001", password: ADMIN.password } });
  const csrf = (await api.storageState()).cookies.find((c) => c.name === "csrf_token")!.value;
  return { api, patch: (url: string, data: object) => api.patch(url, { data, headers: { "X-CSRF-Token": csrf } }) };
}
