const { test, expect } = require("./fixtures");
const { devLogin, toast, newClient, connected } = require("./helpers");

test("a failed release is explained on the app overview and on Home", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-api");
	await connected(page);
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
	await expect(failure.locator('[data-state="failed"]')).toHaveText(/Checking it responds/);
	await expect(failure).toContainText("Your app didn't answer at / on port 8080 within 60 seconds.");
	await expect(failure.locator("mark")).toContainText("no response on port 8080");
	await expect(failure.getByRole("link", { name: "Change health check" })).toBeVisible();
	// The app's log names the port it really listens on, so that is the main action.
	await expect(failure).toContainText("Its log says it listens on port 3000, but the health check uses port 8080.");
	await expect(failure.getByRole("button", { name: "Use port 3000 and publish" })).toBeVisible();

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

test("a wrong port is fixed from the failure screen in one step", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-store");
	await connected(page);
	await page.getByRole("button", { name: "Publish a commit" }).click();
	const dialog = page.getByRole("dialog", { name: "Publish a commit" });
	await dialog.getByLabel("Commit SHA").fill("dead" + "1".repeat(36));
	await dialog.getByRole("button", { name: "Publish", exact: true }).click();
	const failure = page.locator(".failure");
	await expect(failure).toBeVisible({ timeout: 15_000 });
	await failure.getByRole("button", { name: "Use port 3000 and publish" }).click();
	await toast(page, "Publishing store at dead111 on port 3000.");
	// The simulated app listens on 3000, so the same commit now goes live.
	await expect(failure).toBeHidden({ timeout: 15_000 });
	await expect(page.locator("#live-title").locator("..")).toContainText("dead111", { timeout: 15_000 });
	await page.goto("/apps/dev-app-store/settings");
	await expect(page.locator("#app-port")).toHaveValue("3000");
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
