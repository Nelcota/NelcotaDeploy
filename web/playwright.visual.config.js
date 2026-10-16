// Visual regression inside the pinned Playwright container (make visual).
// Baselines live in e2e/visual.spec.js-snapshots/container/ so they never mix
// with host-rendered baselines used by the local `VISUAL=1` path. Missing
// baselines fail instead of being written; refresh with `make visual-update`.
const base = require("./playwright.config.js");

module.exports = {
	...base,
	snapshotPathTemplate: "{testDir}/{testFilePath}-snapshots/container/{arg}{ext}",
	updateSnapshots: "none",
};
