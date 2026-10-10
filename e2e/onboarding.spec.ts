import { test, expect } from "@playwright/test";
import { gotoApp } from "./tauri-mock";

test.describe("Onboarding", () => {
  test("affiche le formulaire si identité absente", async ({ page }) => {
    await gotoApp(page, {
      settings: { user_first_name: "", user_last_name: "" },
    });
    await expect(page.getByText("Bienvenue dans l'application")).toBeVisible();
    await expect(page.getByPlaceholder("Votre prénom")).toBeVisible();
    await expect(page.getByRole("button", { name: "Commencer" })).toBeDisabled();
  });

  test("active Commencer après saisie", async ({ page }) => {
    await gotoApp(page, {
      settings: { user_first_name: "", user_last_name: "" },
    });
    await page.getByPlaceholder("Votre prénom").fill("Ada");
    await page.getByPlaceholder("Votre nom").fill("Lovelace");
    await expect(page.getByRole("button", { name: "Commencer" })).toBeEnabled();
  });
});
