import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("login page loads with form fields", async ({ page }) => {
    await page.goto("/auth/login");

    // CardTitle renders as a div, not a heading role — use text match
    await expect(page.getByText("Login").first()).toBeVisible();
    await expect(page.locator("input#email")).toBeVisible();
    await expect(page.locator("input#password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Login" })
    ).toBeVisible();
  });

  test("login page has sign-up and forgot password links", async ({
    page,
  }) => {
    await page.goto("/auth/login");

    await expect(page.getByRole("link", { name: /sign up/i })).toBeVisible();
    await expect(
      page.getByRole("link", { name: /forgot your password/i })
    ).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input#email").fill("invalid@example.com");
    await page.locator("input#password").fill("wrongpassword");
    await page.getByRole("button", { name: "Login" }).click();

    // Should show an error message
    await expect(page.locator(".text-red-500")).toBeVisible({
      timeout: 10_000,
    });
  });

  test("successful login redirects to chat", async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input#email").fill("chris@chrisgscott.me");
    await page.locator("input#password").fill("chris@chrisgscott.me");
    await page.getByRole("button", { name: "Login" }).click();

    await page.waitForURL("**/chat**", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/chat/);
  });

  test("unauthenticated user is redirected to login", async ({ page }) => {
    // Try to access a protected page directly
    await page.goto("/documents");

    // Should redirect to login
    await page.waitForURL("**/auth/login**", { timeout: 15_000 });
    await expect(page).toHaveURL(/\/auth\/login/);
  });
});
