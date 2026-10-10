import { test, expect } from "@playwright/test";
import { gotoApp } from "./tauri-mock";

test.describe("Musiques / Browse", () => {
  test("champ URL et analyse disponibles", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-browse").click();
    const input = page.locator("[data-url-input]");
    await expect(input).toBeVisible();
    await input.fill("https://www.youtube.com/watch?v=aqz-KE-bpKQ");
    await page.getByRole("button", { name: "Analyser" }).click();
    await expect(page.getByText("Analyzed Video")).toBeVisible({ timeout: 10_000 });
  });
});
