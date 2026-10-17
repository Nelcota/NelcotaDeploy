const path = require("node:path");
const { test, expect } = require("./fixtures");
const { devLogin, toast, newClient } = require("./helpers");

test("add, see, and remove a profile photo", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings");
	const sidebar = page.getByRole("complementary", { name: "Sidebar" });
	await expect(sidebar.locator("summary.avatar img")).toHaveCount(0);

	// The image opens in the editor; saving uploads it.
	await page.locator("#avatar-file").setInputFiles(path.join(__dirname, "../static/src/mascot.png"));
	await page.locator("#image-editor").getByRole("button", { name: "Save" }).click();
	await toast(page, "Profile photo saved.");
	const img = sidebar.locator("summary.avatar img");
	await expect(img).toBeVisible();
	await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth)).toBe(256);
	await expect(page.locator("#profile-photo img")).toBeVisible();

	// It stays after a reload and shows on the team page.
	await page.reload();
	await expect(sidebar.locator("summary.avatar img")).toBeVisible();
	await page.goto("/settings/users");
	await expect(page.locator('#team img[data-avatar="development-user"]')).toBeVisible();

	await page.goto("/settings");
	await page.getByRole("button", { name: "Remove photo" }).click();
	await toast(page, "Profile photo removed.");
	await expect(sidebar.locator("summary.avatar img")).toHaveCount(0);
	await expect(page.getByRole("button", { name: "Add photo" })).toBeVisible();
});

test("a large camera photo is reduced in the browser before upload", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings");
	// A 3000 px noise PNG is several MB, far over the panel's 1 MiB request limit.
	const size = await page.evaluate(async () => {
		const c = document.createElement("canvas");
		c.width = c.height = 3000;
		const g = c.getContext("2d"), d = g.createImageData(3000, 3000);
		for (let i = 0; i < d.data.length; i++) d.data[i] = (i * 2654435761) >>> 24;
		g.putImageData(d, 0, 0);
		const blob = await new Promise((r) => c.toBlob(r, "image/png"));
		const input = document.getElementById("avatar-file"), files = new DataTransfer();
		files.items.add(new File([blob], "camera.png", { type: "image/png" }));
		input.files = files.files;
		input.dispatchEvent(new Event("change", { bubbles: true }));
		return blob.size;
	});
	expect(size).toBeGreaterThan(2 << 20);
	await page.locator("#image-editor").getByRole("button", { name: "Save" }).click();
	await toast(page, "Profile photo saved.");
	await expect(page.locator("#profile-photo img")).toBeVisible();
});

test("an unreadable file gets a clear message", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings");
	await page.locator("#avatar-file").setInputFiles({ name: "notes.png", mimeType: "image/png", buffer: Buffer.from("not an image") });
	await toast(page, "This image can't be read. Use a JPEG, PNG, or WebP image.");
	await expect(page.getByRole("heading", { name: "Edit image" })).toBeHidden();
});
