const fs = require("node:fs");
const { test, expect } = require("./fixtures");
const { devLogin, toast, newClient, connected } = require("./helpers");

const screenText = (page) => page.locator("#terminal .xterm-rows").innerText();

test("deploy and watch build logs live", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-api/deployments");
	await connected(page);
	await page.getByRole("button", { name: "Publish latest" }).click();
	await toast(page, "Publishing api at");
	await page.locator("#deployments > ul > li").first().getByRole("link", { name: /Logs for/ }).click();
	await expect(page).toHaveURL(/\/logs\?deployment=/);
	// Lines arrive from the simulated agent through /api/events while the page is open.
	await expect.poll(() => screenText(page), { timeout: 15_000 }).toContain("[route] traffic switched");
	await expect(page.locator("#log-status")).toHaveAttribute("data-status", "success");
	await expect(page.locator("#log-conn")).toHaveText("Finished");
	const text = await screenText(page);
	expect(text.indexOf("[clone] SHA verified")).toBeLessThan(text.indexOf("[route] traffic switched"));
	// The snapshot and the live stream overlap; lines must not be duplicated.
	expect(text.split("[route] traffic switched").length - 1).toBe(1);
});

test("runtime logs follow live and can be paused", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-api/logs?deployment=runtime");
	await connected(page, page.locator("#log-conn"));
	await expect.poll(() => screenText(page), { timeout: 10_000 }).toContain("GET /health 200");
	await page.getByRole("button", { name: "Pause" }).click();
	await expect(page.getByRole("button", { name: "Resume" })).toHaveAttribute("aria-pressed", "true");
	await expect(page.locator("#log-held")).toContainText(/new lines? arrived while paused/i, { timeout: 10_000 });
	const before = await page.evaluate(() => window.NelcotaLogs.lines());
	await page.getByRole("button", { name: "Resume" }).click();
	await expect(page.locator("#log-held")).toBeHidden();
	expect(await page.evaluate(() => window.NelcotaLogs.lines())).toBeGreaterThanOrEqual(before);
});

test("large build logs render quickly and support search and download", async ({ page }) => {
	const count = 50_000;
	const text = Array.from({ length: count }, (_, i) => `[build] step ${i} \x1b[32mok\x1b[0m compiling package module-${i % 97}`).join("\n") + "\n";
	expect(text.length).toBeLessThan(4 << 20);
	await page.route("**/api/deployments/dev-deploy-api-success/logs", (route) => route.fulfill({ json: { text } }));
	await newClient(page);
	await devLogin(page);
	// page.route() disables the HTTP cache, so every navigation downloads all
	// assets again; continue as a new client to stay under the per-IP burst limit.
	await newClient(page);
	const started = Date.now();
	await page.goto("/apps/dev-app-api/logs?deployment=dev-deploy-api-success");
	await expect.poll(() => page.evaluate(() => window.NelcotaLogs.lines()), { timeout: 20_000 }).toBe(count);
	await expect.poll(() => page.evaluate(() => window.NelcotaLogs.pending()), { timeout: 20_000 }).toBe(0);
	const elapsed = Date.now() - started;
	console.log(`rendered ${count} lines in ${elapsed} ms`);
	expect(elapsed).toBeLessThan(8_000);
	await expect.poll(() => screenText(page)).toContain(`step ${count - 1}`);

	// The page stays interactive: search finds a line deep in the buffer.
	await page.getByLabel("Search logs").fill("step 12345 ");
	await page.getByLabel("Search logs").press("Enter");
	await expect(page.locator("#log-matches")).toHaveText("1 of 1");
	await expect.poll(() => screenText(page)).toContain("step 12345 ok");
	// A finished build doesn't grow, so there is nothing to follow or pause.
	await expect(page.getByRole("button", { name: "Follow" })).toBeHidden();
	await expect(page.getByRole("button", { name: "Pause" })).toBeHidden();

	const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download" }).click()]);
	expect(download.suggestedFilename()).toBe("api-bbbbbbb-dev-deploy-api-success.log");
	const saved = fs.readFileSync(await download.path(), "utf8");
	expect(saved.split("\n").filter(Boolean)).toHaveLength(count);
});
