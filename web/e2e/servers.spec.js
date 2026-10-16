const { test, expect } = require("./fixtures");
const { devLogin, toast, newClient } = require("./helpers");

test("servers show live metrics, invitations, and cache cleanup", async ({ page, context }) => {
	await context.grantPermissions(["clipboard-read", "clipboard-write"]);
	await newClient(page);
	await devLogin(page);
	await page.goto("/servers");
	await expect(page.locator("#metrics-conn")).toHaveText("Live");
	const api = page.locator('[data-server="dev-server-api"]');
	await expect(api.locator('[data-metric="cpu"]')).toHaveText(/\d+\.\d%/, { timeout: 10_000 });
	// Two samples draw the chart.
	await expect(api.locator("[data-chart] canvas")).toBeVisible({ timeout: 10_000 });
	await api.locator("summary", { hasText: "Containers" }).click();
	await expect(api.locator("[data-containers]")).toContainText("api");

	await page.getByRole("button", { name: "Add server" }).click();
	const dialog = page.getByRole("dialog", { name: "Add a server" });
	await expect(dialog.getByLabel("WireGuard address")).toHaveValue("10.77.0.5");
	await dialog.getByLabel("Name").fill("apps-2");
	await dialog.getByRole("button", { name: "Create invitation" }).click();
	await expect(dialog.getByRole("heading")).toBeHidden();
	const result = page.locator("#invite-result");
	await expect(result).toContainText("Install the agent on apps-2");
	await expect(result.locator("[data-expires]")).toHaveText(/1[45]:\d\d remaining/);
	await expect(result.locator("#install-command")).toContainText("--join-file /root/nelcota-join");
	await result.getByRole("button", { name: "Copy commands" }).click();
	await toast(page, "Copied to clipboard");
	expect(await page.evaluate(() => navigator.clipboard.readText())).toContain("/agent.sh");
	await expect(page.locator("#servers-list")).toContainText("apps-2");

	await expect(api.locator('[data-metric="cache"]')).toHaveText(/GiB of 5\.0 GiB/);
	await api.getByRole("button", { name: "Free up space" }).click();
	await page.getByRole("dialog", { name: "Free up space on Server api" }).getByRole("button", { name: "Clear cache" }).click();
	await toast(page, "Clearing the build cache.");
});
