import { test, expect } from "@playwright/test";

test.describe("REST API Health Check", () => {
  test("GET /api/v1/health returns ok without auth", async ({ request }) => {
    const response = await request.get("/api/v1/health");

    expect(response.ok()).toBe(true);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
  });
});
