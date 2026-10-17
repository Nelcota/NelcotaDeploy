const path = require("node:path");
const { test, expect } = require("./fixtures");
const { devLogin, toast, newClient } = require("./helpers");

// choose builds a w×h PNG (left half red, right half blue, or all red) in the
// page and hands it to a file input, as if the person had picked it.
async function choose(page, input, w, h, halves) {
	await page.evaluate(async ([input, w, h, halves]) => {
		const c = document.createElement("canvas");
		c.width = w;
		c.height = h;
		const g = c.getContext("2d");
		g.fillStyle = "#f00";
		g.fillRect(0, 0, w, h);
		if (halves) { g.fillStyle = "#00f"; g.fillRect(w / 2, 0, w / 2, h); }
		const blob = await new Promise((r) => c.toBlob(r, "image/png"));
		const el = document.querySelector(input), files = new DataTransfer();
		files.items.add(new File([blob], "test.png", { type: "image/png" }));
		el.files = files.files;
		el.dispatchEvent(new Event("change", { bubbles: true }));
	}, [input, w, h, halves]);
}

// color names the editor canvas pixel at a fraction of its size.
function color(page, fx, fy) {
	return page.locator("#image-editor canvas").evaluate((c, [fx, fy]) => {
		const [r, , b] = c.getContext("2d").getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data;
		return r > 200 && b < 60 ? "red" : b > 200 && r < 60 ? "blue" : `rgb ${r} ${b}`;
	}, [fx, fy]);
}

// pixels reads a saved image back through a canvas (same origin, so untainted).
function pixels(img) {
	return img.evaluate(async (el) => {
		await el.decode();
		const c = document.createElement("canvas");
		c.width = el.naturalWidth;
		c.height = el.naturalHeight;
		const g = c.getContext("2d");
		g.drawImage(el, 0, 0);
		return { w: c.width, data: Array.from(g.getImageData(0, 0, c.width, c.height).data) };
	});
}

test("closing the editor uploads nothing", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings");
	let uploads = 0;
	page.on("request", (r) => { if (r.url().endsWith("/ui/account/avatar")) uploads++; });
	const editor = page.locator("#image-editor");

	await page.locator("#avatar-file").setInputFiles(path.join(__dirname, "../static/src/mascot.png"));
	await expect(editor.getByRole("heading", { name: "Edit image" })).toBeVisible();
	await expect(editor).toHaveAttribute("data-shape", "circle");
	await expect(editor.getByRole("button", { name: "Original" })).toHaveAttribute("aria-pressed", "true");
	await editor.getByRole("button", { name: "Cancel" }).click();
	await expect(editor.getByRole("heading", { name: "Edit image" })).toBeHidden();

	// Picking the same file again works, and Escape also closes without saving.
	await page.locator("#avatar-file").setInputFiles(path.join(__dirname, "../static/src/mascot.png"));
	await expect(editor.getByRole("heading", { name: "Edit image" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(editor.getByRole("heading", { name: "Edit image" })).toBeHidden();
	// An outside click must not discard the edits.
	await page.locator("#avatar-file").setInputFiles(path.join(__dirname, "../static/src/mascot.png"));
	await page.mouse.click(5, 5);
	await expect(editor.getByRole("heading", { name: "Edit image" })).toBeVisible();
	await editor.getByRole("button", { name: "Cancel" }).click();

	expect(uploads).toBe(0);
});

test("move, zoom, rotate, flip, and start over", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings");
	const editor = page.locator("#image-editor"), stage = editor.locator("[data-editor-stage]"), zoom = editor.getByRole("slider", { name: "Zoom" });
	await choose(page, "#avatar-file", 300, 200, true);
	await expect(editor.getByRole("heading", { name: "Edit image" })).toBeVisible();
	// The wide image is cropped to the square: red on the left, blue on the right.
	await expect.poll(() => color(page, 0.25, 0.5)).toBe("red");
	await expect.poll(() => color(page, 0.75, 0.5)).toBe("blue");

	// Dragging moves the image inside the round frame.
	await expect.poll(() => color(page, 0.4, 0.5)).toBe("red");
	const box = await stage.boundingBox();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 - box.width / 2, box.y + box.height / 2, { steps: 5 });
	await page.mouse.up();
	await expect.poll(() => color(page, 0.4, 0.5)).toBe("blue");

	// Keyboard: + zooms in; arrows move.
	await stage.focus();
	await page.keyboard.press("+");
	await expect.poll(async () => Number(await zoom.inputValue())).toBeGreaterThan(1);

	await editor.getByRole("button", { name: "Start over" }).click();
	await expect(zoom).toHaveValue("1");
	await expect.poll(() => color(page, 0.4, 0.5)).toBe("red");

	await editor.getByRole("button", { name: "Flip" }).click();
	await expect.poll(() => color(page, 0.25, 0.5)).toBe("blue");
	await editor.getByRole("button", { name: "Start over" }).click();

	// Rotating right puts the left side on top.
	await editor.getByRole("button", { name: "Rotate right" }).click();
	await expect.poll(() => color(page, 0.5, 0.25)).toBe("red");
	await expect.poll(() => color(page, 0.5, 0.75)).toBe("blue");
	await editor.getByRole("button", { name: "Rotate left" }).click();
	await editor.getByRole("button", { name: "Rotate left" }).click();
	await expect.poll(() => color(page, 0.5, 0.25)).toBe("blue");
	await editor.getByRole("button", { name: "Cancel" }).click();
});

test("a style and sliders change the saved photo", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings");
	const editor = page.locator("#image-editor");
	await page.locator("#avatar-file").setInputFiles(path.join(__dirname, "../static/src/mascot.png"));
	await expect(editor.getByRole("heading", { name: "Edit image" })).toBeVisible();

	// A style moves the sliders, so the result stays adjustable.
	await editor.getByRole("button", { name: "Black and white" }).click();
	await expect(editor.getByRole("button", { name: "Black and white" })).toHaveAttribute("aria-pressed", "true");
	await expect(editor.getByLabel("Saturation")).toHaveValue("-100");
	await expect(editor.locator('output[for="editor-saturation"]')).toHaveText("-100");
	// Moving a slider by hand clears the style.
	await editor.getByLabel("Brightness").fill("20");
	await expect(editor.locator('output[for="editor-brightness"]')).toHaveText("20");
	await expect(editor.getByRole("button", { name: "Black and white" })).toHaveAttribute("aria-pressed", "false");

	await editor.getByRole("button", { name: "Save" }).click();
	await toast(page, "Profile photo saved.");
	await expect(editor.getByRole("heading", { name: "Edit image" })).toBeHidden();
	// The stored photo is grayscale: red, green, and blue stay equal (JPEG noise aside).
	const { data } = await pixels(page.locator("#profile-photo img"));
	let spread = 0;
	for (let i = 0; i < data.length; i += 4) spread = Math.max(spread, Math.abs(data[i] - data[i + 1]), Math.abs(data[i + 1] - data[i + 2]));
	expect(spread).toBeLessThan(10);

	await page.getByRole("button", { name: "Remove photo" }).click();
	await toast(page, "Profile photo removed.");
});

test("logos keep transparency and fit whole", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/apps/dev-app-api/settings");
	const editor = page.locator("#image-editor");
	// A wide wordmark fits inside the square with transparent bands above and below.
	await choose(page, "#logo-file", 300, 100, false);
	await expect(editor).toHaveAttribute("data-shape", "square");
	await editor.getByRole("button", { name: "Save" }).click();
	await toast(page, "Logo saved.");
	const { w, data } = await pixels(page.locator("#app-header-logo img"));
	expect(w).toBe(256);
	expect(data[3]).toBe(0);
	const middle = (128 * w + 128) * 4;
	expect(data.slice(middle, middle + 4)).toEqual([255, 0, 0, 255]);

	await page.getByRole("button", { name: "Remove logo" }).click();
	await toast(page, "Logo removed.");
});
