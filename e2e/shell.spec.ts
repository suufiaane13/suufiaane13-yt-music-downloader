import { test, expect } from "@playwright/test";
import { gotoApp } from "./tauri-mock";

test.describe("Shell navigation", () => {
  test("sidebar navigue vers chaque page", async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId("app-root")).toBeVisible();
    await expect(page.getByTestId("engine-ok")).toBeVisible();

    for (const tab of ["explore", "lecture", "downloads", "settings", "browse"] as const) {
      await page.getByTestId(`nav-${tab}`).click();
      await expect(page.getByTestId(`page-${tab}`)).toBeVisible();
    }
  });

  test("bannière moteur manquant", async ({ page }) => {
    await gotoApp(page, { engine: { ytDlp: false, ffmpeg: true, ffprobe: true } });
    await expect(page.getByTestId("engine-missing")).toBeVisible();
    await expect(page.getByTestId("engine-missing")).toContainText("yt-dlp");
  });
});
