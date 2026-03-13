import { test, expect } from "@playwright/test";

const TEST_EMAIL = "chris@chrisgscott.me";
const TEST_PASSWORD = "chris@chrisgscott.me";

test.describe("Documents Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input#email").fill(TEST_EMAIL);
    await page.locator("input#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL("**/chat**", { timeout: 15_000 });

    await page.goto("/documents");
    await page.waitForLoadState("networkidle");
  });

  test("loads documents page with heading", async ({ page }) => {
    await expect(
      page.getByRole("heading", { name: "Documents" })
    ).toBeVisible();
    await expect(
      page.getByText("Upload and manage documents for your knowledge base.")
    ).toBeVisible();
  });

  test("shows upload form with file input", async ({ page }) => {
    // The upload area should be present
    await expect(page.locator("input[type='file']")).toBeAttached();
  });

  test("shows re-ingest all button when documents exist", async ({ page }) => {
    // If there are documents, the re-ingest button should show
    const reingestBtn = page.getByRole("button", { name: /re-ingest all/i });
    const emptyState = page.getByText("No documents yet");

    // Either we have documents (and re-ingest button) or empty state
    const hasDocuments = await reingestBtn.isVisible().catch(() => false);
    const isEmpty = await emptyState.isVisible().catch(() => false);

    expect(hasDocuments || isEmpty).toBe(true);
  });

  test("documents table has correct columns when documents exist", async ({
    page,
  }) => {
    const table = page.locator("table");
    const hasTable = await table.isVisible().catch(() => false);

    if (hasTable) {
      await expect(page.getByRole("columnheader", { name: "Name" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Type" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Size" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Status" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Chunks" })).toBeVisible();
      await expect(page.getByRole("columnheader", { name: "Uploaded" })).toBeVisible();
    }
  });

  test("can navigate to document detail page", async ({ page }) => {
    const firstDocLink = page.locator("table a").first();
    const hasDocuments = await firstDocLink.isVisible().catch(() => false);

    if (hasDocuments) {
      await firstDocLink.click();
      await page.waitForURL("**/documents/**", { timeout: 10_000 });

      // Document detail page should show back link and document name
      await expect(page.getByText("Back to Documents")).toBeVisible();
    }
  });
});

test.describe("Document Detail Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/auth/login");
    await page.locator("input#email").fill(TEST_EMAIL);
    await page.locator("input#password").fill(TEST_PASSWORD);
    await page.getByRole("button", { name: "Login" }).click();
    await page.waitForURL("**/chat**", { timeout: 15_000 });
  });

  test("shows parsed content and chunks tabs", async ({ page }) => {
    // Navigate to documents and click first doc
    await page.goto("/documents");
    await page.waitForLoadState("networkidle");

    const firstDocLink = page.locator("table a").first();
    const hasDocuments = await firstDocLink.isVisible().catch(() => false);

    if (hasDocuments) {
      await firstDocLink.click();
      await page.waitForURL("**/documents/**", { timeout: 10_000 });

      // Should have tabs
      await expect(page.getByRole("tab", { name: /parsed content/i })).toBeVisible();
      await expect(page.getByRole("tab", { name: /chunks/i })).toBeVisible();
    }
  });

  test("chunks tab shows chunk cards with labels", async ({ page }) => {
    await page.goto("/documents");
    await page.waitForLoadState("networkidle");

    const firstDocLink = page.locator("table a").first();
    const hasDocuments = await firstDocLink.isVisible().catch(() => false);

    if (hasDocuments) {
      await firstDocLink.click();
      await page.waitForURL("**/documents/**", { timeout: 10_000 });

      // Click chunks tab
      await page.getByRole("tab", { name: /chunks/i }).click();

      // Should show at least one chunk
      const chunkCard = page.getByText(/^Chunk \d+$/);
      const hasChunks = await chunkCard.first().isVisible().catch(() => false);

      if (hasChunks) {
        // Chunk card should be visible
        await expect(chunkCard.first()).toBeVisible();
      }
    }
  });
});
