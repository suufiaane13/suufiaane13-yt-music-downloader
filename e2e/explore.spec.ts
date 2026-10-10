import { test, expect } from "@playwright/test";
import { gotoApp } from "./tauri-mock";

test.describe("Explorer", () => {
  test("recherche affiche des résultats mockés", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-explore").click();
    const search = page.getByPlaceholder(/Rechercher|search|YouTube/i).first();
    await expect(search).toBeVisible();
    await search.fill("lofi");
    await search.press("Enter");
    await expect(page.getByText("Mock Track")).toBeVisible({ timeout: 10_000 });
  });
});
