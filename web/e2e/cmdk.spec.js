const { test, expect } = require("@playwright/test");
const { devLogin, toast, newClient } = require("./helpers");

test("command palette navigates and runs actions from the keyboard", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	// Deferred scripts are running once the live stream reports in.
	await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
	await page.keyboard.press("Control+K");
	const palette = page.getByRole("dialog", { name: "Command palette" });
	const input = palette.getByRole("combobox");
	// The <dialog> box itself is zero-sized (its panel is fixed), so check the input.
	await expect(input).toBeVisible();
	await expect(input).toBeFocused();
	await expect(palette.getByRole("option").first()).toHaveAttribute("aria-selected", "true");

	await input.fill("blog runtime");
	await expect(palette.getByRole("option")).toHaveCount(1);
	await input.press("Enter");
	await expect(page).toHaveURL("/apps/dev-app-blog/logs?deployment=runtime");
	await expect(page.locator("#log-conn")).toHaveText("Live");

	// Arrow keys move the selection; Enter runs a Datastar action.
	await page.keyboard.press("Control+K");
	await input.fill("store");
	const options = palette.getByRole("option");
	await expect(options.first()).toHaveAttribute("aria-selected", "true");
	await input.press("ArrowUp"); // wraps to the last match
	await input.press("ArrowDown"); // and back to the first
	await expect(options.first()).toHaveAttribute("aria-selected", "true");
	await input.fill("publish store");
	await expect(options).toHaveCount(1);
	const action = palette.getByRole("option", { name: /Publish store/ });
	await expect(action).toHaveAttribute("aria-selected", "true");
	await expect(input).toHaveAttribute("aria-activedescendant", await action.getAttribute("id"));
	await input.press("Enter");
	await expect(input).toBeHidden();
	await toast(page, "Publishing store at");

	await page.keyboard.press("Control+K");
	await input.fill("dark theme");
	await input.press("Enter");
	await expect(page.locator("html")).toHaveClass(/dark/);
	await page.goto("/settings");
	await expect(page.getByLabel("Theme")).toHaveValue("dark");

	await page.keyboard.press("Control+K");
	await input.fill("zzzz-nothing");
	await expect(palette.getByText("No matching commands.")).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(input).toBeHidden();
});
