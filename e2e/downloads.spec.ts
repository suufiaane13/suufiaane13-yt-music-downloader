import { test, expect } from "@playwright/test";
import { gotoApp } from "./tauri-mock";

test.describe("Téléchargements", () => {
  test("affiche la file et la recherche", async ({ page }) => {
    await gotoApp(page, {
      tasks: [
        {
          id: "t1",
          url: "https://youtu.be/x",
          title: "Ma Chanson",
          status: "completed",
          progress: 100,
          speed_bytes: 0,
          speed_mbps: 0,
          eta: 0,
          media: "audio",
          video_format: "best",
        },
      ],
    });
    await page.getByTestId("nav-downloads").click();
    await expect(page.getByTestId("downloads-page")).toBeVisible();
    await expect(page.getByText("Ma Chanson")).toBeVisible();
    await page.getByTestId("dl-search").fill("introuvable");
    await expect(page.getByText("Ma Chanson")).toHaveCount(0);
  });
});
