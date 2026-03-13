import { test, expect } from "@playwright/test";

const TEST_EMAIL = "chris@chrisgscott.me";
const TEST_PASSWORD = "chris@chrisgscott.me";

test.describe("Sidebar Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input#email").fill(TEST_EMAIL);
    await page.locator("input#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL("**/chat**", { timeout: 15_000 });
  });

  test("sidebar shows all navigation items", async ({ page }) => {
    // App nav
    await expect(page.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Documents" })).toBeVisible();

    // Admin nav
    await expect(page.getByRole("link", { name: "Evaluation" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Optimizer" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Usage" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("can navigate to documents via sidebar", async ({ page }) => {
    await page.getByRole("link", { name: "Documents" }).click();
    await page.waitForURL("**/documents", { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "Documents" })
    ).toBeVisible();
  });

  test("can navigate to evaluation via sidebar", async ({ page }) => {
    await page.getByRole("link", { name: "Evaluation" }).click();
    await page.waitForURL("**/eval", { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "Evaluation" })
    ).toBeVisible();
  });

  test("can navigate to optimizer via sidebar", async ({ page }) => {
    await page.getByRole("link", { name: "Optimizer" }).click();
    await page.waitForURL("**/optimize", { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "Auto-Optimizer" })
    ).toBeVisible();
  });

  test("can navigate to settings via sidebar", async ({ page }) => {
    await page.getByRole("link", { name: "Settings" }).click();
    await page.waitForURL("**/settings", { timeout: 10_000 });
    await expect(
      page.getByRole("heading", { name: "Settings" })
    ).toBeVisible();
  });
});
