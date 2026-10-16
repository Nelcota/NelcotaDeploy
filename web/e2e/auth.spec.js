const { test, expect } = require("@playwright/test");
const { virtualAuthenticator, devLogin, totp, nextWindow, toast, newClient, signOut } = require("./helpers");

test("passkey sign-in, two-factor setup, and recovery codes", async ({ page }) => {
	test.setTimeout(150_000);
	await virtualAuthenticator(page);
	await newClient(page);
	await devLogin(page);

	// Add a passkey with the virtual authenticator (the development session is fresh).
	await page.goto("/settings");
	await page.getByRole("button", { name: "Add passkey" }).click();
	await toast(page, "Passkey added.");
	await expect(page.getByText("Passkey 1")).toBeVisible();

	// Sign out and back in with the passkey.
	await signOut(page);
	await expect(page).toHaveURL(/\/login/);
	await page.getByLabel("Email").fill("dev@localhost");
	await page.getByRole("button", { name: "Sign in with passkey" }).click();
	await expect(page).toHaveURL("/");

	// Enable TOTP: the QR and setup key appear once; confirming signs everyone out.
	await page.goto("/settings");
	await page.getByRole("button", { name: "Set up authenticator" }).click();
	await expect(page.getByRole("img", { name: "QR code for your authenticator app" })).toBeVisible();
	const secret = (await page.locator("#totp-secret").textContent()).trim();
	await page.getByRole("textbox", { name: "Authenticator code" }).fill(totp(secret));
	await page.getByRole("button", { name: "Enable two-factor" }).click();
	await expect(page).toHaveURL(/notice=totp-enabled/);
	await expect(page.getByText("Two-factor authentication is on.")).toBeVisible();

	await newClient(page);
	// Passkey, then a code from the next window (the activation code cannot be reused).
	await nextWindow(page);
	await page.getByLabel("Email").fill("dev@localhost");
	await page.getByRole("button", { name: "Sign in with passkey" }).click();
	await page.getByRole("textbox", { name: "Authenticator code" }).fill(totp(secret));
	await page.getByRole("button", { name: "Verify" }).click();
	await expect(page).toHaveURL("/");

	// Recovery codes are shown once and replace the authenticator for one sign-in.
	await page.goto("/settings");
	await page.getByRole("button", { name: "Generate recovery codes" }).click();
	await page.getByRole("dialog", { name: "Generate new recovery codes?" }).getByRole("button", { name: "Generate codes" }).click();
	await expect(page.locator("#recovery-list li")).toHaveCount(10);
	const codes = await page.locator("#recovery-list li").allTextContents();

	await newClient(page);
	await signOut(page);
	await page.getByLabel("Email").fill("dev@localhost");
	await page.getByRole("button", { name: "Sign in with passkey" }).click();
	await page.getByRole("button", { name: "Use a recovery code" }).click();
	await page.getByRole("textbox", { name: "Recovery code" }).fill(codes[0]);
	await page.getByRole("button", { name: "Verify" }).click();
	await expect(page).toHaveURL("/");
	await page.goto("/settings");
	await expect(page.getByText("9 unused recovery codes.")).toBeVisible();
});

test("unknown accounts get a clear error", async ({ page }) => {
	await page.goto("/login");
	await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
	await page.getByLabel("Email").fill("nobody@example.com");
	await virtualAuthenticator(page);
	await page.getByRole("button", { name: "Sign in with passkey" }).click();
	await expect(page.getByRole("alert").filter({ hasText: "Login unavailable for this account" })).toBeVisible();
});
