const { test, expect } = require("./fixtures");

// Budgets on a local network: first contentful paint and largest contentful
// paint under 1 s, layout shift during loading under 0.05, and instant
// navigations through prefetching. Each page loads in a fresh context (cold
// HTTP cache). Shifts caused later by live status changes are not counted.
for (const path of ["/", "/apps/dev-app-api", "/apps/dev-app-api/deployments", "/apps/dev-app-api/logs", "/servers", "/settings"]) {
	test(`web vitals within budget (cold cache): ${path}`, async ({ browser, baseURL }) => {
		const context = await browser.newContext({ baseURL, extraHTTPHeaders: { "X-Forwarded-For": "192.0.2.77" } });
		const page = await context.newPage();
		await page.addInitScript(() => {
			window.__vitals = { cls: 0, lcp: 0 };
			new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
			new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) window.__vitals.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
		});
		await page.request.post("/api/dev/session", { data: {}, headers: { Origin: new URL(baseURL).origin } });
		await page.goto(path, { waitUntil: "load" });
		await page.waitForTimeout(500);
		const v = await page.evaluate(() => ({ fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null, ...window.__vitals }));
		console.log(`${path}: FCP ${Math.round(v.fcp)} ms, LCP ${Math.round(v.lcp)} ms, CLS ${v.cls.toFixed(3)}`);
		expect(v.fcp).not.toBeNull();
		expect(v.fcp).toBeLessThan(1000);
		expect(v.lcp).toBeLessThan(1000);
		expect(v.cls).toBeLessThan(0.05);
		await context.close();
	});
}

test("hovering a link prefetches the next page", async ({ page, baseURL }) => {
	await page.setExtraHTTPHeaders({ "X-Forwarded-For": "192.0.2.78" });
	await page.request.post("/api/dev/session", { data: {}, headers: { Origin: new URL(baseURL).origin } });
	await page.goto("/");
	await page.locator('aside a.rail-link[href="/servers"]').hover();
	await page.waitForTimeout(800);
	await page.locator('aside a.rail-link[href="/servers"]').click();
	await page.waitForLoadState("load");
	expect(await page.evaluate(() => performance.getEntriesByType("navigation")[0].deliveryType)).toBe("navigational-prefetch");
});
