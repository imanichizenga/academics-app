import { chromium } from "@playwright/test";
const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "../screenshots";
const pages = (process.argv[2] ?? "/,/explore,/pricing,/login").split(",");
const sizes = (process.argv[3] ?? "360,390,768,1024,1440").split(",").map(Number);
const dark = process.env.DARK === "1";
const auth = process.env.AUTH; // phone:password
const browser = await chromium.launch();
let problems = 0;
for (const width of sizes) {
  const ctx = await browser.newContext({ viewport: { width, height: width < 768 ? 800 : 900 }, colorScheme: dark ? "dark" : "light", hasTouch: width < 768, isMobile: width < 768 });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Download the React DevTools|401|403/.test(m.text())) { problems++; console.log(`  console[${width}] ${page.url()}: ${m.text().slice(0, 240)}`); } });
  page.on("pageerror", (e) => { problems++; console.log(`  pageerror[${width}] ${page.url()}: ${e.message.slice(0, 240)}`); });
  if (auth) {
    const [phone, password] = auth.split(":");
    const r = await ctx.request.post(`${BASE}/api/v1/auth/login/`, { data: { phone, password } });
    if (!r.ok()) console.log("login failed", r.status());
  }
  for (const path of pages) {
    const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 90000 }).catch((e) => { console.log("goto", path, e.message.slice(0,100)); return null; });
    await page.waitForTimeout(900);
    const over = await page.evaluate(() => { const w = document.documentElement.clientWidth; const bad = [...document.querySelectorAll("body *")].filter((el) => { const r = el.getBoundingClientRect(); if (r.width === 0 || r.right <= w + 1) return false; for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return false; } return true; }); return { sw: document.documentElement.scrollWidth, w, bad: bad.slice(0, 3).map((e) => `${e.tagName}.${String(e.className).slice(0, 50)}`) }; });
    const smalls = width < 768 ? await page.evaluate(() => [...document.querySelectorAll("nav a, button, [role=button]")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32; }).length) : 0;
    const name = `${(path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home")}-${width}${dark ? "-dark" : ""}`;
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const flag = over.sw > over.w || over.bad.length;
    if (flag) problems++;
    console.log(`${res?.status()} ${width}px ${path}${flag ? ` OVERFLOW scroll=${over.sw}/${over.w} ${over.bad.join(" ")}` : ""}${smalls ? ` smallTargets=${smalls}` : ""}`);
  }
  await ctx.close();
}
await browser.close();
console.log("problems:", problems);
