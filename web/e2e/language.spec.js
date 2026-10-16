const { test, expect } = require("./fixtures");
const { devLogin, newClient } = require("./helpers");

// Expected Portuguese text comes from the catalog the page embeds for scripts,
// so this file stays in English (AGENTS.md allows Portuguese only in the catalog).
const catalog = (page) => page.evaluate(() => JSON.parse(document.getElementById("i18n").textContent));

test("switch to Portuguese in account settings and back", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings");
	const choice = page.getByRole("group", { name: "Language" });
	await expect(choice.locator('a[hreflang="en"]')).toHaveAttribute("aria-current", "true");
	await choice.locator('a[hreflang="pt-BR"]').click();
	await expect(page).toHaveURL("/settings");
	await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
	await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Settings");
	const group = page.locator("#preferences [role=group]");
	await expect(group.locator('a[hreflang="pt-BR"]')).toHaveAttribute("aria-current", "true");

	// Scripts render their text in the same language, and the choice survives navigation.
	await page.goto("/servers");
	const words = await catalog(page);
	await expect(page.getByRole("status").filter({ hasText: words["connection|Live"] })).toBeVisible();
	await page.locator('aside a.rail-link[href="/"]').click();
	await page.locator("#app-row-dev-app-api button[aria-label$=' api']").first().click();
	const toaster = page.locator("#toaster");
	await expect(toaster).toContainText(" api ");
	await expect(toaster).not.toContainText("Publishing");

	await page.goto("/settings");
	await group.locator('a[hreflang="en"]').click();
	await expect(page.locator("html")).toHaveAttribute("lang", "en");
	await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");
	await expect(page.locator("#i18n")).toHaveCount(0);
});

test("the sign-in page has its own language menu", async ({ page }) => {
	await newClient(page);
	await page.goto("/login");
	const menu = page.locator("details.lang-menu");
	await menu.locator("summary").click();
	await menu.locator('a[hreflang="pt-BR"]').click();
	await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
	await expect(page).toHaveURL("/login");
	await page.keyboard.press("Escape");
	await menu.locator("summary").click();
	await expect(menu.locator('a[hreflang="en"]')).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(menu.locator('a[hreflang="en"]')).toBeHidden();
});

test("the sign-in page follows the browser language", async ({ browser, baseURL }) => {
	const context = await browser.newContext({ baseURL, locale: "pt-BR", extraHTTPHeaders: { "X-Forwarded-For": "192.0.2.90" } });
	const page = await context.newPage();
	await page.goto("/login");
	await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
	await expect(page.locator("#i18n")).toHaveCount(1);
	await expect(page.getByRole("button", { name: "Sign in with passkey" })).toHaveCount(0);
	await context.close();
});
