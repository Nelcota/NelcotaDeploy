const { test, expect } = require("./fixtures");
const AxeBuilder = require("@axe-core/playwright").default;
const { devLogin, newClient } = require("./helpers");

// Every screen, in both themes, must have no WCAG 2.2 A/AA violations
// (including color contrast) according to axe-core.
const pages = [
	"/", "/apps", "/apps/new", "/apps/dev-app-api", "/apps/dev-app-api/deployments", "/apps/dev-app-api/logs", "/apps/dev-app-api/logs?deployment=runtime",
	"/apps/dev-app-api/settings", "/servers", "/settings", "/settings/users", "/settings/github", "/settings/audit", "/settings/platform",
];

for (const scheme of ["light", "dark"]) {
	test.describe(`${scheme} theme`, () => {
		test.use({ colorScheme: scheme });

		test("sign-in and enrollment pages", async ({ page }) => {
			for (const path of ["/login", "/enroll"]) {
				await page.goto(path);
				const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
				expect(result.violations.map((v) => `${path}: ${v.id} ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
			}
		});

		test("authenticated pages", async ({ page }) => {
			test.setTimeout(120_000);
			await newClient(page);
			await devLogin(page);
			const violations = [];
			for (const path of pages) {
				await page.goto(path);
				await page.waitForLoadState("load");
				await page.waitForTimeout(400);
				const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
				for (const v of result.violations) violations.push(`${path}: ${v.id} (${v.impact}) ${v.nodes.slice(0, 3).map((n) => n.target.join(" ") + " — " + n.failureSummary.split("\n").slice(1, 2).join("")).join(" | ")}`);
			}
			expect(violations).toEqual([]);
		});
	});
}
