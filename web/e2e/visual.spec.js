// Visual regression of the component gallery. Opt in with VISUAL=1; refresh
// baselines with VISUAL=1 npx playwright test e2e/visual.spec.js --update-snapshots.
// Baselines are platform-specific, so compare on the machine that created them.
const { test, expect } = require("./fixtures");
const { devLogin, newClient, settled } = require("./helpers");

test.skip(!process.env.VISUAL, "set VISUAL=1 to compare screenshots");

for (const scheme of ["light", "dark"]) {
	test(`component gallery (${scheme})`, async ({ page }) => {
		await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
		await page.setViewportSize({ width: 1280, height: 900 });
		await newClient(page);
		await devLogin(page);
		await page.goto("/dev/components");
		await settled(page);
		await expect(page).toHaveScreenshot(`gallery-${scheme}.png`, { fullPage: true, mask: [page.locator(".conn"), page.locator(".rail")], maxDiffPixelRatio: 0.01 });
	});
}
