import { expect, test } from "@playwright/test";

test("home renders match dashboard", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "USDT wager chess lobby" }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", { name: /match dashboard/i }),
  ).toBeVisible();
});
