import { test, expect } from "@playwright/test";

const TEST_EMAIL = "chris@chrisgscott.me";
const TEST_PASSWORD = "chris@chrisgscott.me";

test.describe("Evaluation Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input#email").fill(TEST_EMAIL);
    await page.locator("input#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL("**/chat**", { timeout: 15_000 });
  });

  test("loads eval page with tabs", async ({ page }) => {
    await page.goto("/eval");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Evaluation" })
    ).toBeVisible();
    await expect(
      page.getByText("Measure retrieval quality and answer accuracy.")
    ).toBeVisible();

    // Check tabs
    await expect(page.getByRole("tab", { name: /test sets/i })).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /run evaluation/i })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: /results history/i })
    ).toBeVisible();
  });

  test("can switch between eval tabs", async ({ page }) => {
    await page.goto("/eval");
    await page.waitForLoadState("networkidle");

    // Click "Run Evaluation" tab
    await page.getByRole("tab", { name: /run evaluation/i }).click();
    await expect(
      page.getByRole("tabpanel").first()
    ).toBeVisible();

    // Click "Results History" tab
    await page.getByRole("tab", { name: /results history/i }).click();
    await expect(
      page.getByRole("tabpanel").first()
    ).toBeVisible();
  });
});

test.describe("Auto-Optimizer Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input#email").fill(TEST_EMAIL);
    await page.locator("input#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL("**/chat**", { timeout: 15_000 });
  });

  test("loads optimizer page with heading", async ({ page }) => {
    await page.goto("/optimize");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Auto-Optimizer" })
    ).toBeVisible();
    await expect(
      page.getByText(
        "Tune RAG pipeline configuration through iterative experiments."
      )
    ).toBeVisible();
  });
});

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input#email").fill(TEST_EMAIL);
    await page.locator("input#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL("**/chat**", { timeout: 15_000 });
  });

  test("loads settings page with heading", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    await expect(
      page.getByRole("heading", { name: "Settings" })
    ).toBeVisible();
    await expect(
      page.getByText("Manage model rates and configuration.")
    ).toBeVisible();
  });
});
