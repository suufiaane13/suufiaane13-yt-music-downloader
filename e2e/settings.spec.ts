import { test, expect } from "@playwright/test";
import { gotoApp } from "./tauri-mock";

test.describe("Paramètres", () => {
  test("affiche version et contrôles moteur", async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId("nav-settings").click();
    await expect(page.getByTestId("page-settings")).toBeVisible();
    await expect(page.getByText(/Version de l'app/)).toBeVisible();
    await expect(page.getByTestId("check-app-update")).toBeVisible();
    await expect(page.getByTestId("download-profile")).toBeVisible();
    await expect(page.getByRole("button", { name: /Re-vérifier/i })).toBeVisible();
  });
});
