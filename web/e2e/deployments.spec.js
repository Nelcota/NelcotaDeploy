const { test, expect } = require("@playwright/test");
const { devLogin, toast, newClient } = require("./helpers");

test("publish a commit, then restore an earlier version with confirmation", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-blog/deployments");
	await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
	const sha = "1234567890abcdef1234567890abcdef12345678";
	await page.getByRole("button", { name: "Publish a commit" }).click();
	const dialog = page.getByRole("dialog", { name: "Publish a commit" });
	await dialog.getByLabel("Commit SHA").fill(sha);
	await dialog.getByLabel("Description").fill("Add search");
	await dialog.getByRole("button", { name: "Publish", exact: true }).click();
	await toast(page, "Publishing blog at 1234567.");
	await expect(dialog.getByRole("heading")).toBeHidden();
	const newest = page.locator("#deployments > ul > li").first();
	await expect(newest).toContainText("Add search");
	await expect(newest).toHaveAttribute("data-deployment-status", "success", { timeout: 15_000 });
	await expect(newest).toContainText("Online now");
	await expect(newest).toContainText("Checking it responds");

	const older = page.locator("#deployment-dev-deploy-blog-success");
	await older.getByRole("button", { name: "Restore version ccccccc" }).click();
	const confirm = page.getByRole("dialog", { name: "Restore version ccccccc?" });
	await expect(confirm).toContainText("goes live after its health check passes.");
	await confirm.getByRole("button", { name: "Restore this version" }).click();
	await toast(page, "Restoring version ccccccc.");
	const restored = page.locator("#deployments > ul > li").first();
	await expect(restored).toContainText("rollback");
	await expect(restored).toHaveAttribute("data-deployment-status", "success", { timeout: 15_000 });
});

test("cancelling asks for confirmation and updates live", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-store/deployments");
	await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
	await page.getByRole("button", { name: "Publish latest" }).click();
	const row = page.locator("#deployments > ul > li").first();
	await row.getByRole("button", { name: "Cancel" }).click();
	await page.getByRole("dialog", { name: "Cancel this deployment?" }).getByRole("button", { name: "Cancel deployment" }).click();
	await expect(row).toHaveAttribute("data-deployment-status", "cancelled", { timeout: 15_000 });
});
