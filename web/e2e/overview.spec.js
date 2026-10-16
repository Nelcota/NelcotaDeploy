const { test, expect } = require("@playwright/test");
const { devLogin, toast, newClient } = require("./helpers");

test("a failed release is explained on the app overview and on Home", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-api");
	await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
	await expect(page.getByRole("heading", { name: "Online now" })).toBeVisible();

	// The development agent fails commits starting with "dead" at the health check.
	await page.getByRole("button", { name: "Publish a commit" }).click();
	const dialog = page.getByRole("dialog", { name: "Publish a commit" });
	await dialog.getByLabel("Commit SHA").fill("dead" + "0".repeat(36));
	await dialog.getByRole("button", { name: "Publish", exact: true }).click();
	await toast(page, "Publishing api at dead000.");

	// While it runs, the steps show where it is.
	await expect(page.getByRole("heading", { name: /Publishing/ })).toBeVisible();
	const failure = page.locator(".failure");
	await expect(failure).toBeVisible({ timeout: 15_000 });
	await expect(failure).toContainText("didn't go live. Your site is still running the previous version.");
	await expect(failure.locator('[data-state="fail"]')).toHaveText(/Checking it responds/);
	await expect(failure).toContainText("Your app didn't answer at / on port 8080 within 60 seconds.");
	await expect(failure.locator("mark")).toContainText("no response on port 8080");
	await expect(failure.getByRole("link", { name: "Change health check" })).toBeVisible();

	await page.getByRole("link", { name: "Home" }).first().click();
	const item = page.locator("#attention-app-dev-app-api");
	await expect(item).toContainText("api didn't go live");
	await expect(item).toContainText("Stopped at the health check");
	await item.getByRole("link", { name: "See why" }).click();
	await expect(page).toHaveURL("/apps/dev-app-api");

	// Trying again starts a new deployment of the same commit.
	await page.getByRole("button", { name: "Try again" }).click();
	await toast(page, "Publishing api at dead000.");
});

test("DNS is checked when the overview opens and survives live updates", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-blog");
	const results = page.locator("#dns-results");
	await expect(results).toContainText(/blog\.example\.test (doesn't resolve yet|points to)/);
	// A deployment redraws the overview live; the DNS results stay.
	await page.getByRole("button", { name: "Publish latest" }).click();
	await expect(page.getByRole("heading", { name: /Publishing/ })).toBeVisible();
	await expect(results).toContainText("blog.example.test");
	await page.getByRole("button", { name: "Check again" }).click();
	await expect(results).toContainText("blog.example.test");
});
