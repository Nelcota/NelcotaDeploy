const { test, expect } = require("@playwright/test");
const { devLogin, toast, newClient } = require("./helpers");

test("home shows live metrics, and Publish updates the app's status live", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Needs your attention" })).toBeVisible();
	await expect(page.locator("#server-dev-server-api").getByText("CPU")).toBeVisible();
	const row = page.locator("#app-row-dev-app-api");
	await row.getByRole("button", { name: "Publish the latest version of api" }).click();
	await toast(page, "Publishing api at");
	const status = row.locator("[data-state]");
	await expect(status).toHaveAttribute("data-state", /publishing|live/);
	await expect(row).toContainText(/Getting code|Building|Starting|Checking it responds|Switching traffic|Waiting/);
	await expect(status).toHaveAttribute("data-state", "live", { timeout: 15_000 });
	await expect(status).toHaveText("Live");
});

test("mobile layout has no horizontal scroll and a tab bar", async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await newClient(page);
	await devLogin(page);
	const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
	expect(overflow).toBeLessThanOrEqual(0);
	await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
	const tabs = page.locator(".tabbar");
	await tabs.getByRole("link", { name: "Servers" }).click();
	await expect(page).toHaveURL("/servers");
	await expect(tabs.getByRole("link", { name: "Servers" })).toHaveAttribute("aria-current", "page");
});
