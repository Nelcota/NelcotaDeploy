// Generates docs/screenshots (run with SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.js).
const path = require("node:path");
const { test, expect } = require("./fixtures");
const { devLogin, newClient, settled } = require("./helpers");

const out = process.env.SCREENSHOTS_DIR || path.resolve(__dirname, "../../docs/screenshots");
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate screenshots");

// Each screen waits for its live data before the picture is taken.
const logLines = (n) => async (page) => page.waitForFunction((n) => window.NelcotaLogs && window.NelcotaLogs.lines() >= n, n);
const screens = [
	["dashboard", "/", async (page) => expect(page.locator(".mini-meter").first()).toBeVisible({ timeout: 15_000 })],
	["app-overview", "/apps/dev-app-api", async (page) => expect(page.locator("ul#dns-results")).toBeVisible()],
	["apps", "/apps"],
	["new-app", "/apps/new"],
	["deployments", "/apps/dev-app-api/deployments"],
	["build-logs", "/apps/dev-app-api/logs", logLines(1)],
	["runtime-logs", "/apps/dev-app-api/logs?deployment=runtime", logLines(5)],
	["app-settings", "/apps/dev-app-api/settings"],
	// A few samples so the charts show a line.
	["servers", "/servers", async (page) => page.waitForFunction(() => [...document.querySelectorAll("[data-chart]")].every((c) => c.querySelector(".uplot")), null, { timeout: 30_000 })],
	["account", "/settings"],
	["team", "/settings/users"],
	["connections", "/settings/github"],
	["activity", "/settings/audit"],
	["system", "/settings/platform"],
];
async function show(page, url, ready) {
	await page.goto(url);
	if (ready) await ready(page);
	await settled(page);
}
const mobile = ["dashboard", "app-overview", "apps", "deployments", "build-logs", "app-settings", "servers", "account"];

for (const scheme of ["light", "dark"]) {
	test.describe(scheme, () => {
		test.use({ colorScheme: scheme });
		test(`public pages (${scheme})`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 800 });
			for (const [name, url] of [["login", "/login"], ["enroll", "/enroll"]]) {
				await page.goto(url);
				await page.screenshot({ path: `${out}/${name}-${scheme}.png` });
			}
		});
		test(`panel pages (${scheme})`, async ({ page }) => {
			test.setTimeout(180_000);
			await page.setViewportSize({ width: 1280, height: 900 });
			await newClient(page);
			await devLogin(page);
			for (const [name, url, ready] of screens) {
				await show(page, url, ready);
				await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: true });
			}
			// Interactive states.
			await page.goto("/apps/new");
			await page.getByLabel("GitHub repository").fill("https://github.com/example/docs");
			await page.getByRole("button", { name: "Continue" }).click();
			await expect(page.getByRole("heading", { name: "Check the settings" })).toBeVisible();
			await settled(page);
			await page.screenshot({ path: `${out}/new-app-settings-${scheme}.png`, fullPage: true });
			await page.goto("/apps/dev-app-store");
			await page.getByRole("button", { name: "Publish a commit" }).click();
			await page.getByRole("dialog", { name: "Publish a commit" }).getByLabel("Commit SHA").fill("dead" + "0".repeat(36));
			await page.getByRole("dialog", { name: "Publish a commit" }).getByRole("button", { name: "Publish", exact: true }).click();
			await expect(page.locator("#publishing-title")).toBeVisible();
			await settled(page);
			await page.screenshot({ path: `${out}/app-publishing-${scheme}.png`, fullPage: true });
			await expect(page.locator(".failure")).toBeVisible({ timeout: 15_000 });
			await page.screenshot({ path: `${out}/app-failure-${scheme}.png`, fullPage: true });
			await page.goto("/apps/dev-app-api/deployments");
			await page.getByRole("button", { name: "Publish a commit" }).click();
			// The <dialog> itself has no box (its panel is fixed-positioned), so wait for its contents.
			await expect(page.locator("#deploy-commit-title")).toBeVisible();
			await expect(page.locator("#deploy-commit-list input[name=sha]").first()).toBeVisible();
			await settled(page);
			await page.screenshot({ path: `${out}/deploy-dialog-${scheme}.png` });
			await page.keyboard.press("Escape");
			await page.keyboard.press("Control+K");
			await expect(page.locator("#cmdk-list [role=option]").first()).toBeVisible();
			await page.locator("#cmdk-input").fill("api");
			await expect(page.locator('#cmdk-list [role=option][aria-selected="true"]')).toContainText(/api/i);
			await page.screenshot({ path: `${out}/command-palette-${scheme}.png` });
		});
		test(`mobile (${scheme})`, async ({ page }) => {
			test.setTimeout(120_000);
			await page.setViewportSize({ width: 390, height: 844 });
			await newClient(page);
			await devLogin(page);
			for (const [name, url, ready] of screens.filter((s) => mobile.includes(s[0]))) {
				await show(page, url, ready);
				await page.screenshot({ path: `${out}/mobile-${name}-${scheme}.png`, fullPage: true });
			}
		});
		test(`portuguese (${scheme})`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 900 });
			await newClient(page);
			await devLogin(page);
			const pt = Object.fromEntries(screens.map(([name, , ready]) => [name, ready]));
			for (const [name, url, ready] of [["pt-dashboard", "/?lang=pt-BR", pt.dashboard], ["pt-app-overview", "/apps/dev-app-api", pt["app-overview"]], ["pt-servers", "/servers", pt.servers]]) {
				await show(page, url, ready);
				await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: true });
			}
			await page.goto("/settings");
			await page.locator("#preferences").screenshot({ path: `${out}/preferences-${scheme}.png` });
		});
	});
}
