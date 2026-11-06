// Full visual sweep: every required page at every width, light and dark. Writes to ../screenshots/sweep.
import fs from "node:fs";
import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "../screenshots/sweep";
fs.mkdirSync(OUT, { recursive: true });
const WIDTHS = (process.env.WIDTHS ?? "360,390,768,1024,1440").split(",").map(Number);
const THEMES = (process.env.THEMES ?? "light,dark").split(",");
const LOCKED = "electricity-at-home-explained";
const FREE = process.env.FREE_SLUG ?? "solving-linear-equations-without-fear";
const STUDENT = { phone: "255754200001", password: "darasa-demo-2026" };
const ADMIN = { phone: "255754000001", password: "darasa-demo-2026" };
const guest = [["home", "/"], ["explore", "/explore"], ["locked", `/content/${LOCKED}`], ["login", "/login"], ["forgot", "/forgot"], ["pricing", "/pricing"]];
const student = [["unlocked", `/content/${LOCKED}`], ["library", "/library"], ["account", "/account"]];
const admin = [["dashboard", "/admin"], ["users", "/admin/users"], ["orders", "/admin/orders"], ["s-payments", "/admin/settings/payments"], ["s-notifications", "/admin/settings/notifications"], ["s-storage", "/admin/settings/storage"], ["s-general", "/admin/settings/general"]];
const browser = await chromium.launch();
let problems = 0;
const report = (m) => { problems++; console.log(m); };
async function open(ctx, name, width, theme, path, after) {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/40[13]|favicon/.test(m.text())) report(`console ${name}-${width}-${theme}: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => report(`pageerror ${name}-${width}-${theme}: ${e.message.slice(0, 200)}`));
  await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(350);
  if (after) await after(page);
  // scrollWidth misses anything cut off by overflow-x: clip, so check each visible element's edges too.
  const over = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const inScroller = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return true; } return false; };
    return [...document.querySelectorAll("body *")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && (r.right > width + 1 || r.left < -1) && !inScroller(el) && !el.closest("[aria-hidden=true]");
    }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)}`);
  });
  if (over.length) report(`OVERFLOW ${name}-${width}-${theme}: ${over.join(" | ")}`);
  await page.screenshot({ path: `${OUT}/${name}-${width}-${theme}.png`, fullPage: process.env.FULL === "1" });
  await page.close();
}
for (const theme of THEMES) for (const width of WIDTHS) {
  const opts = { viewport: { width, height: width < 768 ? 800 : 900 }, colorScheme: theme, isMobile: width < 768, hasTouch: width < 768 };
  const init = (ctx) => ctx.addInitScript(() => { try { sessionStorage.setItem("booted", "1"); } catch {} });
  const g = await browser.newContext(opts); await init(g);
  for (const [n, p] of guest) await open(g, n, width, theme, p);
  await open(g, "checkout-form", width, theme, `/content/${LOCKED}`, async (page) => { await page.getByRole("button", { name: /Buy this lesson/ }).click(); await page.waitForTimeout(500); });
  await open(g, "checkout-waiting", width, theme, `/content/${LOCKED}`, async (page) => {
    await page.getByRole("button", { name: /Buy this lesson/ }).click();
    await page.getByLabel("Mobile money number").fill(`0754${String(Math.floor(100000 + Math.random() * 899999))}`);
    await page.getByLabel("First name").fill("Asha"); await page.getByLabel("Last name").fill("Mushi");
    await page.getByRole("button", { name: /^Pay TZS/ }).click();
    await page.getByTestId("checkout-waiting").waitFor();
    await page.screenshot({ path: `${OUT}/checkout-waiting-${width}-${theme}.png` });
    await page.getByTestId("checkout-success").waitFor({ timeout: 30000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${OUT}/checkout-success-${width}-${theme}.png` });
  });
  await g.close();
  const s = await browser.newContext(opts); await init(s);
  await s.request.post(`${BASE}/api/v1/auth/login/`, { data: STUDENT });
  for (const [n, p] of student) await open(s, n, width, theme, p);
  await s.close();
  const a = await browser.newContext(opts); await init(a);
  await a.request.post(`${BASE}/api/v1/auth/login/`, { data: ADMIN });
  for (const [n, p] of admin) await open(a, n, width, theme, p);
  const first = (await (await a.request.get(`${BASE}/api/v1/admin/contents/?page_size=1`)).json()).results[0];
  await open(a, "editor", width, theme, `/admin/contents/${first.id}`, async (page) => {
    const body = page.getByLabel("Lesson body"); await body.click();
    await page.keyboard.press("Home"); for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.waitForTimeout(300);
  });
  const order = (await (await a.request.get(`${BASE}/api/v1/admin/orders/?status=completed&page_size=1`)).json()).results[0];
  if (order) await open(a, "receipt", width, theme, `/library/receipts/${order.id}`);
  await a.close();
  console.log("done", theme, width);
}
// Maintenance page, for every width and theme.
const boss = await browser.newContext();
await boss.request.post(`${BASE}/api/v1/auth/login/`, { data: ADMIN });
const csrf = (await boss.cookies()).find((c) => c.name === "csrf_token").value;
const flip = (maintenance_mode) => boss.request.patch(`${BASE}/api/v1/admin/settings/site/`, { data: { maintenance_mode }, headers: { "X-CSRF-Token": csrf } });
await flip(true);
await new Promise((r) => setTimeout(r, 11000));
try {
  for (const theme of THEMES) for (const width of WIDTHS) {
    const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, colorScheme: theme });
    await open(ctx, "maintenance", width, theme, "/");
    await ctx.close();
  }
} finally { await flip(false); }
await browser.close();
console.log("problems:", problems);
