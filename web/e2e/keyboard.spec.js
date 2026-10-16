const { test, expect } = require("./fixtures");
const AxeBuilder = require("@axe-core/playwright").default;
const { devLogin, newClient } = require("./helpers");

const axe = (page) => new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();

test("skip link, visible focus, and keyboard-operable dialogs", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();

	// The first Tab reaches the skip link, which moves focus to the main content.
	await page.keyboard.press("Tab");
	const skip = page.getByRole("link", { name: "Skip to content" });
	await expect(skip).toBeFocused();
	await expect(skip).toBeVisible();
	await page.keyboard.press("Enter");
	await expect(page.locator("#main")).toBeFocused();

	// Focus is always visible on keyboard navigation.
	await page.keyboard.press("Tab");
	const outline = await page.evaluate(() => {
		const el = document.activeElement, s = getComputedStyle(el);
		return { tag: el.tagName, outline: s.outlineStyle !== "none" && s.outlineWidth !== "0px", ring: s.boxShadow !== "none" };
	});
	expect(outline.outline || outline.ring).toBe(true);

	// Confirmation dialogs open from the keyboard, trap focus, pass axe, and close with Escape.
	await page.goto("/apps/dev-app-api/settings");
	const stop = page.getByRole("button", { name: "Stop", exact: true });
	await stop.focus();
	await page.keyboard.press("Enter");
	const dialog = page.getByRole("dialog", { name: "Stop api?" });
	await expect(dialog.getByRole("button", { name: "Go back" })).toBeFocused();
	expect((await axe(page)).violations).toEqual([]);
	await page.keyboard.press("Escape");
	await expect(dialog.getByRole("heading")).toBeHidden();
	await expect(stop).toBeFocused();

	// The command palette passes axe while open.
	await page.keyboard.press("Control+K");
	await expect(page.locator("#cmdk-input")).toBeFocused();
	await expect(page.locator("#cmdk-list [role=option]").first()).toBeVisible();
	expect((await axe(page)).violations).toEqual([]);
	await page.keyboard.press("Escape");
});

test("theme and language live in account settings, not the sidebar", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await newClient(page);
	await devLogin(page);
	const sidebar = page.getByRole("complementary", { name: "Sidebar" });
	await expect(sidebar.getByRole("button", { name: "Toggle dark theme" })).toHaveCount(0);
	await expect(page.locator("details.lang-menu")).toHaveCount(0);
	await page.goto("/settings");
	const theme = page.getByLabel("Theme");
	await theme.focus();
	await theme.selectOption("dark");
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/dark/);
	await expect(page.getByRole("group", { name: "Language" }).locator('a[hreflang="en"]')).toHaveAttribute("aria-current", "true");
});

test("theme toggle on the sign-in page is a labelled, pressed-state button", async ({ page }) => {
	await page.emulateMedia({ colorScheme: "light" });
	await newClient(page);
	await page.goto("/login");
	const toggle = page.getByRole("button", { name: "Toggle dark theme" });
	await expect(toggle).toHaveAttribute("aria-pressed", "false");
	await toggle.focus();
	await page.keyboard.press("Enter");
	await expect(page.locator("html")).toHaveClass(/dark/);
	await expect(toggle).toHaveAttribute("aria-pressed", "true");
	await page.reload();
	await expect(page.locator("html")).toHaveClass(/dark/);
});

test("g then a letter opens a primary page, except while typing", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.keyboard.press("g");
	await page.keyboard.press("s");
	await expect(page).toHaveURL("/servers");
	await page.keyboard.press("g");
	await page.keyboard.press("c");
	await expect(page).toHaveURL("/settings");
	await page.keyboard.press("g");
	await page.keyboard.press("h");
	await expect(page).toHaveURL("/");
	// Typing in a field never navigates.
	await page.keyboard.press("Control+K");
	await page.keyboard.type("ga");
	await expect(page).toHaveURL("/");
	await page.keyboard.press("Escape");
	// The rail announces each shortcut.
	await expect(page.locator('aside a.rail-link[href="/apps"]')).toHaveAttribute("aria-keyshortcuts", "g a");
});

test("the account menu shows who is signed in and opens the account page", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	const sidebar = page.getByRole("complementary", { name: "Sidebar" });
	await expect(sidebar.getByRole("button", { name: "Sign out" })).toBeHidden();
	await sidebar.getByLabel("Account menu").click();
	await expect(sidebar.getByText("dev@localhost")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(sidebar.getByText("dev@localhost")).toBeHidden();
	await sidebar.getByLabel("Account menu").click();
	await sidebar.getByRole("link", { name: "My account" }).click();
	await expect(page).toHaveURL("/settings");
});
