// Generates docs/screenshots (run with SCREENSHOTS=1 npx playwright test e2e/screenshots.spec.js).
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { devLogin, newClient } = require("./helpers");

const out = process.env.SCREENSHOTS_DIR || path.resolve(__dirname, "../../docs/screenshots");
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1 to regenerate screenshots");

const screens = [
	["dashboard", "/", 4000],
	["app-overview", "/apps/dev-app-api", 1500],
	["apps", "/apps", 300],
	["new-app", "/apps/new", 300],
	["deployments", "/apps/dev-app-api/deployments", 800],
	["build-logs", "/apps/dev-app-api/logs", 1000],
	["runtime-logs", "/apps/dev-app-api/logs?deployment=runtime", 5000],
	["app-settings", "/apps/dev-app-api/settings", 300],
	["servers", "/servers", 9000],
	["account", "/settings", 300],
	["team", "/settings/users", 300],
	["connections", "/settings/github", 300],
	["activity", "/settings/audit", 300],
	["system", "/settings/platform", 300],
];
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
			for (const [name, url, wait] of screens) {
				await page.goto(url);
				await page.waitForTimeout(wait);
				await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: true });
			}
			// Interactive states.
			await page.goto("/apps/new");
			await page.getByLabel("GitHub repository").fill("https://github.com/example/docs");
			await page.getByRole("button", { name: "Continue" }).click();
			await expect(page.getByRole("heading", { name: "Check the settings" })).toBeVisible();
			await page.screenshot({ path: `${out}/new-app-settings-${scheme}.png`, fullPage: true });
			await page.goto("/apps/dev-app-store");
			await page.getByRole("button", { name: "Publish a commit" }).click();
			await page.getByRole("dialog", { name: "Publish a commit" }).getByLabel("Commit SHA").fill("dead" + "0".repeat(36));
			await page.getByRole("dialog", { name: "Publish a commit" }).getByRole("button", { name: "Publish", exact: true }).click();
			await page.waitForTimeout(700);
			await page.screenshot({ path: `${out}/app-publishing-${scheme}.png`, fullPage: true });
			await expect(page.locator(".failure")).toBeVisible({ timeout: 15_000 });
			await page.screenshot({ path: `${out}/app-failure-${scheme}.png`, fullPage: true });
			await page.goto("/apps/dev-app-api/deployments");
			await page.getByRole("button", { name: "Publish a commit" }).click();
			await page.waitForTimeout(300);
			await page.screenshot({ path: `${out}/deploy-dialog-${scheme}.png` });
			await page.keyboard.press("Escape");
			await page.keyboard.press("Control+K");
			await expect(page.locator("#cmdk-list [role=option]").first()).toBeVisible();
			await page.locator("#cmdk-input").fill("api");
			await page.waitForTimeout(200);
			await page.screenshot({ path: `${out}/command-palette-${scheme}.png` });
		});
		test(`mobile (${scheme})`, async ({ page }) => {
			test.setTimeout(120_000);
			await page.setViewportSize({ width: 390, height: 844 });
			await newClient(page);
			await devLogin(page);
			for (const [name, url, wait] of screens.filter((s) => mobile.includes(s[0]))) {
				await page.goto(url);
				await page.waitForTimeout(wait);
				await page.screenshot({ path: `${out}/mobile-${name}-${scheme}.png`, fullPage: true });
			}
		});
		test(`portuguese (${scheme})`, async ({ page }) => {
			await page.setViewportSize({ width: 1280, height: 900 });
			await newClient(page);
			await devLogin(page);
			for (const [name, url, wait] of [["pt-dashboard", "/?lang=pt-BR", 2500], ["pt-app-overview", "/apps/dev-app-api", 1500], ["pt-servers", "/servers", 2500]]) {
				await page.goto(url);
				await page.waitForTimeout(wait);
				await page.screenshot({ path: `${out}/${name}-${scheme}.png`, fullPage: true });
			}
			await page.goto("/settings");
			await page.locator("#preferences").screenshot({ path: `${out}/preferences-${scheme}.png` });
		});
	});
}
