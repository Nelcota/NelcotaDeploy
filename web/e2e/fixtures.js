// Every test fails when a page throws an uncaught JavaScript error, so a
// broken script can't hide behind assertions that still pass.
const base = require("@playwright/test");

const test = base.test.extend({
	page: async ({ page }, use) => {
		const errors = [];
		page.on("pageerror", (e) => errors.push(e.message));
		await use(page);
		base.expect(errors, "uncaught errors in the page").toEqual([]);
	},
});

module.exports = { test, expect: base.expect };
