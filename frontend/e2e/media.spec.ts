import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN, login } from "./helpers";

// Playwright's bundled Chromium has no H.264 decoder, so playback tests need real Chrome.
test.use({ channel: "chrome" });

test("a locked video plays its preview, then really stops", async ({ page }) => {
  await page.goto("/content/quadratic-equations-step-by-step");
  await expect(page.getByTestId("video-player")).toContainText("Preview · 12s");
  await page.getByRole("button", { name: "Play video" }).click();
  const video = page.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(1);
  const seekable = await video.evaluate((v: HTMLVideoElement) => v.duration);
  expect(seekable).toBeLessThanOrEqual(20); // the source is 24 seconds: the server cut the playlist
  await video.evaluate((v: HTMLVideoElement) => { v.currentTime = v.duration - 0.5; });
  await expect(page.getByTestId("preview-ended")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("paywall")).toBeVisible();
});

test("free video plays with quality and speed controls, and the keyboard works", async ({ page }) => {
  await page.goto("/content/forces-and-motion-in-everyday-life");
  await expect(page.getByTestId("video-player")).not.toContainText("Preview");
  await page.getByRole("button", { name: "Play video" }).click();
  const video = page.locator("video");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime), { timeout: 20_000 }).toBeGreaterThan(1);
  expect(await video.evaluate((v: HTMLVideoElement) => v.duration)).toBeGreaterThan(20);
  await page.getByRole("button", { name: "Playback speed" }).click();
  await page.getByRole("menuitem", { name: "1.5x" }).click();
  expect(await video.evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(1.5);
  await page.getByTestId("video-player").focus();
  await page.keyboard.press("k");
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test("a locked PDF shows only its preview pages", async ({ page }) => {
  await page.goto("/content/form-four-algebra-revision-pack");
  const viewer = page.getByTestId("pdf-viewer");
  await expect(viewer.locator("canvas")).toBeVisible({ timeout: 30_000 });
  await expect(viewer).toContainText("1 / 3 of 8");
});

test("comments: a signed-in student posts one, optimistically", async ({ page }) => {
  await login(page, "0754100000", ADMIN.password);
  await expect(page).toHaveURL(/\/library/);
  await page.goto("/content/how-vaccines-teach-the-body");
  const text = `Very helpful ${Date.now()}`;
  await page.getByLabel("Your comment").first().fill(text);
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  const posted = page.getByRole("paragraph").filter({ hasText: text });
  await expect(posted).toBeVisible();
  await page.reload();
  await expect(posted).toBeVisible();
  await page.getByRole("button", { name: "Bookmark" }).click();
  await expect(page.getByText(/Saved to your library|Removed from your library/)).toBeVisible();
});

for (const [name, path] of [["home", "/"], ["explore", "/explore"], ["pricing", "/pricing"], ["login", "/login"], ["content", "/content/electricity-at-home-explained"]] as const) {
  for (const scheme of ["light", "dark"] as const) {
    test(`accessibility: ${name} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path, { waitUntil: "networkidle" });
      const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
      expect(violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }
}
