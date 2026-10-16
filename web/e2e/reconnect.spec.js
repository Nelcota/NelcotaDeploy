const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("@playwright/test");

// These tests run their own panel so they can stop and restart it while the
// browser holds live streams, exactly like a panel restart or network loss.
const port = 18282;
const origin = `http://localhost:${port}`;
const data = path.resolve(__dirname, "../../.local/e2e-restart");
let panel;

async function start() {
	panel = spawn(path.resolve(__dirname, "../../bin/nelcota-panel"), ["dev"], {
		env: { ...process.env, NELCOTA_DEV_DATA_DIR: data, NELCOTA_DEV_LISTEN: `127.0.0.1:${port}`, NELCOTA_DEV_ORIGIN: origin },
		stdio: "ignore",
	});
	for (let i = 0; i < 100; i++) {
		try { if ((await fetch(`${origin}/healthz`)).ok) return; } catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error("panel did not start");
}
async function stop() {
	if (!panel) return;
	const exited = new Promise((r) => panel.once("exit", r));
	panel.kill("SIGTERM");
	await exited;
	panel = null;
}

test.describe.configure({ mode: "serial" });
test.use({ baseURL: origin });
test.beforeAll(async () => { fs.rmSync(data, { recursive: true, force: true }); await start(); });
test.afterAll(stop);

async function signIn(page) {
	await page.goto("/login");
	await page.getByRole("button", { name: "Continue as development administrator" }).click();
	await expect(page).toHaveURL("/");
}

test("dashboard shows the outage and recovers with a fresh snapshot after a restart", async ({ page }) => {
	await signIn(page);
	const conn = page.locator(".conn").first();
	await expect(conn).toHaveAttribute("data-state", "live");
	await stop();
	await expect(conn).toHaveText("Reconnecting…", { timeout: 15_000 });
	await start();
	// The session survives in SQLite; the stream reconnects and resends the snapshot.
	await expect(conn).toHaveText("Live", { timeout: 40_000 });
	await expect(page.locator("#server-dev-server-api")).toContainText("CPU", { timeout: 10_000 });
});

test("log streams reconnect after a restart and mark the gap", async ({ page }) => {
	await signIn(page);
	await page.goto("/apps/dev-app-api/logs?deployment=runtime");
	const conn = page.locator("#log-conn");
	await expect(conn).toHaveText("Live");
	await stop();
	await expect(conn).toHaveText("Reconnecting…", { timeout: 15_000 });
	await start();
	await expect(conn).toHaveText("Live", { timeout: 40_000 });
	await expect.poll(() => page.locator("#terminal .xterm-rows").innerText(), { timeout: 15_000 }).toContain("reconnected");
});
