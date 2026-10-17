const path = require("node:path");
const { test, expect } = require("./fixtures");
const { devLogin, toast, newClient } = require("./helpers");

test("upload, see, and remove an app logo", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-api/settings");
	const header = page.locator("#app-header-logo");
	await expect(header.locator("img")).toHaveCount(0);

	// The image opens in the editor, fitted whole into a square; saving uploads it.
	await page.locator("#logo-file").setInputFiles(path.join(__dirname, "../static/src/mascot.png"));
	await expect(page.locator("#image-editor")).toHaveAttribute("data-shape", "square");
	await page.locator("#image-editor").getByRole("button", { name: "Save" }).click();
	await toast(page, "Logo saved.");
	await expect(header.locator("img")).toBeVisible();
	await expect.poll(() => header.locator("img").evaluate((el) => el.complete && el.naturalWidth)).toBe(256);

	// It replaces the initial on the dashboard.
	await page.goto("/");
	await expect(page.locator('#app-row-dev-app-api img[data-logo="dev-app-api"]')).toBeVisible();

	await page.goto("/apps/dev-app-api/settings");
	await page.getByRole("button", { name: "Remove logo" }).click();
	await toast(page, "Logo removed.");
	await expect(header.locator("img")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Upload logo" })).toBeVisible();
});
