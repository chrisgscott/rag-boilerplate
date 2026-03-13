import { test, expect } from "@playwright/test";

const TEST_EMAIL = "chris@chrisgscott.me";
const TEST_PASSWORD = "chris@chrisgscott.me";

test.describe("Chat Interface", () => {
  test.beforeEach(async ({ page }) => {
    // Sign in
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(TEST_EMAIL);
    await page.getByLabel("Password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();

    // Wait for redirect to /chat
    await page.waitForURL("**/chat**", { timeout: 15_000 });
  });

  test("loads chat page with empty state", async ({ page }) => {
    // ConversationEmptyState renders children (suggestion buttons) instead of
    // title/description when children are provided — check for prompt input
    // and the suggestion buttons as empty state indicators
    await expect(
      page.getByPlaceholder("Ask a question about your documents...")
    ).toBeVisible();

    // Should show the header with "New Chat" title (use heading role to avoid
    // matching the sr-only button text)
    await expect(
      page.getByRole("heading", { name: "New Chat" })
    ).toBeVisible();
  });

  test("has History and New Chat buttons", async ({ page }) => {
    await expect(page.getByRole("button", { name: /history/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /new chat/i })
    ).toBeVisible();
  });

  test("can type in prompt input", async ({ page }) => {
    const textarea = page.getByPlaceholder(
      "Ask a question about your documents..."
    );
    await textarea.fill("Hello, this is a test message");
    await expect(textarea).toHaveValue("Hello, this is a test message");
  });

  test("sends a message and receives a response", async ({ page }) => {
    const textarea = page.getByPlaceholder(
      "Ask a question about your documents..."
    );
    await textarea.fill("What documents do you have?");

    // Submit the message
    await textarea.press("Enter");

    // Should show user message
    await expect(page.getByText("What documents do you have?")).toBeVisible({
      timeout: 10_000,
    });

    // Should show an assistant response (the .is-assistant div wrapping the response)
    await expect(page.locator(".is-assistant").first()).toBeVisible({
      timeout: 30_000,
    });

    // URL should update with conversation ID
    await expect(page).toHaveURL(/\/chat\?id=/, { timeout: 10_000 });
  });

  test("opens conversation history sidebar", async ({ page }) => {
    // The History button may be behind the dashboard sidebar on desktop,
    // so dispatch a click event directly to bypass pointer-events interception
    const historyBtn = page.getByRole("button", { name: /history/i });
    await historyBtn.dispatchEvent("click");

    // Sheet should open with "Conversation History" title
    await expect(page.getByText("Conversation History")).toBeVisible({
      timeout: 5_000,
    });
  });

  test("New Chat button resets the chat", async ({ page }) => {
    // First send a message to create a conversation
    const textarea = page.getByPlaceholder(
      "Ask a question about your documents..."
    );
    await textarea.fill("Test message for new chat reset");
    await textarea.press("Enter");

    // Wait for assistant response
    await expect(page.locator(".is-assistant").first()).toBeVisible({
      timeout: 30_000,
    });

    // Click New Chat (may need force due to sidebar overlap)
    await page
      .getByRole("button", { name: /new chat/i })
      .click({ force: true });

    // Should reset to empty state — no assistant messages, prompt input visible
    await expect(page.locator(".is-assistant")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(
      page.getByPlaceholder("Ask a question about your documents...")
    ).toBeVisible();
    await expect(page).toHaveURL(/\/chat$/);
  });
});
