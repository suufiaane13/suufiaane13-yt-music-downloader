import { test, expect } from "@playwright/test";
import { gotoApp } from "./tauri-mock";

test.describe("Lecture", () => {
  test("liste les fichiers et filtres", async ({ page }) => {
    await gotoApp(page, {
      music: [
        {
          name: "Song.mp3",
          path: "C:\\Music\\Song.mp3",
          sizeBytes: 1000,
          duration: 120,
          kind: "audio",
        },
        {
          name: "Clip.mp4",
          path: "C:\\Music\\Clip.mp4",
          sizeBytes: 2000,
          duration: 60,
          kind: "video",
        },
      ],
    });
    await page.getByTestId("nav-lecture").click();
    await expect(page.getByText("Song", { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Clip", { exact: true })).toBeVisible();
    await page.getByTestId("lecture-filter-audio").click();
    await expect(page.getByText("Song", { exact: true })).toBeVisible();
    await expect(page.getByText("Clip", { exact: true })).toHaveCount(0);
    await page.getByTestId("lecture-filter-video").click();
    await expect(page.getByText("Clip", { exact: true })).toBeVisible();
  });
});
