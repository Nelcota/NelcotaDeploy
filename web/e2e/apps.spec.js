const { test, expect } = require("./fixtures");
const { devLogin, toast, newClient } = require("./helpers");

test("create an app with the wizard and it publishes right away", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.getByRole("link", { name: "New app" }).first().click();
	await expect(page).toHaveURL("/apps/new");
	await page.getByLabel("GitHub repository").fill("https://github.com/example/docs");
	await page.getByRole("button", { name: "Continue" }).click();
	await expect(page.getByRole("heading", { name: "Check the settings" })).toBeVisible();
	await expect(page.getByText("Dockerfile found")).toBeVisible();
	await expect(page.getByLabel("Name")).toHaveValue("docs");
	await expect(page.getByLabel("Your app listens on port")).toHaveValue("8080");
	await page.getByLabel("Branch").selectOption("main");
	await page.getByLabel("Server").selectOption({ label: "Server blog" });
	await page.getByLabel("Web address").fill("docs.example.org");
	await page.getByRole("button", { name: "Create and publish" }).click();
	await expect(page).toHaveURL(/\/apps\/[^/]+$/);
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("docs");
	// The first version goes live without another step.
	await expect(page.getByRole("heading", { name: "Online now" }).locator("..")).toContainText("Version", { timeout: 15_000 });

	await page.getByRole("link", { name: "Settings" }).last().click();
	await page.locator("#section-advanced summary").click();
	await page.getByLabel("Copies").fill("2");
	await page.getByRole("button", { name: "Save changes" }).click();
	await toast(page, "Settings saved.");
	await page.reload();
	await page.locator("#section-advanced summary").click();
	await expect(page.getByLabel("Copies")).toHaveValue("2");
	await expect(page.getByLabel("Web addresses")).toHaveValue("docs.example.org");
});

test("environment variables: paste, review, save, and they stay hidden", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-api/settings");
	const env = page.locator("#env");
	await env.getByLabel("Add or change variables").fill("API_SECRET=hunter2-secret\nREGION=eu");
	await env.getByRole("button", { name: "Review changes" }).click();
	const review = page.locator("#env-review");
	await expect(review).toContainText("API_SECRET");
	await expect(review.locator('[data-kind="add"]')).toHaveCount(2);
	await review.getByRole("button", { name: "Save 2 change(s)" }).click();
	await toast(page, "2 change(s) saved.");
	await expect(env.locator("#env-API_SECRET")).toContainText("••••••••");
	await expect(env.getByLabel("Add or change variables")).toHaveValue("");
	expect(await page.content()).not.toContain("hunter2-secret");
	await page.reload();
	expect(await page.content()).not.toContain("hunter2-secret");

	// Replace one value: masked by default, shown only on request.
	await env.getByRole("button", { name: "Replace value of API_SECRET" }).click();
	const dialog = page.getByRole("dialog", { name: "Replace API_SECRET" });
	const value = dialog.getByLabel("New value");
	await value.fill("rotated");
	await expect(value).toHaveAttribute("type", "password");
	await dialog.getByRole("button", { name: "Show value" }).click();
	await expect(value).toHaveAttribute("type", "text");
	await dialog.getByRole("button", { name: "Save value" }).click();
	await toast(page, "API_SECRET saved.");
	await expect(dialog.getByRole("heading")).toBeHidden();

	await env.getByRole("button", { name: "Delete API_SECRET" }).click();
	await page.getByRole("dialog", { name: "Delete API_SECRET?" }).getByRole("button", { name: "Delete variable" }).click();
	await toast(page, "API_SECRET deleted.");
	await expect(env.locator("#env-API_SECRET")).toHaveCount(0);
});
