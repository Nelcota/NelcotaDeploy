// End-to-end tests run against `nelcota-panel dev` with a fresh data directory.
// localhost (not 127.0.0.1) is required so WebAuthn accepts the RP ID.
const { defineConfig, devices } = require("@playwright/test");

const port = process.env.E2E_PORT || "18181";
const origin = `http://localhost:${port}`;

module.exports = defineConfig({
	testDir: "./e2e",
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: [["list"], ["html", { open: "never" }]],
	use: { baseURL: origin, trace: "retain-on-failure", ...devices["Desktop Chrome"] },
	webServer: {
		command: "rm -rf ../.local/e2e && ../bin/nelcota-panel dev",
		url: `${origin}/healthz`,
		reuseExistingServer: false,
		timeout: 60_000,
		env: { NELCOTA_DEV_DATA_DIR: "../.local/e2e", NELCOTA_DEV_LISTEN: `127.0.0.1:${port}`, NELCOTA_DEV_ORIGIN: origin },
	},
});
