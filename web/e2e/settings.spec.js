const { test, expect } = require("./fixtures");
const { virtualAuthenticator, devLogin, toast, newClient } = require("./helpers");

test("invite a member who enrolls a passkey and gets member access", async ({ page, browser }) => {
	test.setTimeout(90_000);
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings/users");
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await page.getByLabel("Email").fill("member@example.com");
	await page.getByLabel("Name").fill("Mia Member");
	await page.getByRole("button", { name: "Create invitation" }).click();
	const result = page.locator("#user-invite-result");
	await expect(result).toContainText("Invitation for Mia Member");
	await expect(result).toContainText("Works for 24 hours");
	const link = (await result.locator("#enrollment-link").textContent()).trim();
	expect(link).toMatch(/\/enroll#token=/);
	await result.getByText("If the link doesn't open").click();
	const token = (await result.locator("#enrollment-token").textContent()).trim();
	expect(link.endsWith(token)).toBe(true);
	await expect(page.getByLabel("Email")).toHaveValue("");

	// The invited person opens the link in their own browser: one click creates the passkey.
	const other = await browser.newContext();
	const guest = await other.newPage();
	await guest.setExtraHTTPHeaders({ "X-Forwarded-For": "203.0.113.10" });
	await virtualAuthenticator(guest);
	await guest.goto(link);
	// The token leaves the address bar as soon as the page reads it.
	await expect(guest).toHaveURL(/\/enroll$/);
	await guest.getByRole("button", { name: "Create passkey" }).click();
	await expect(guest.getByText("Passkey created")).toBeVisible();
	// Invitations work once, also when the token is pasted by hand.
	await guest.goto("/enroll");
	await guest.getByLabel("Invitation token").fill(token);
	await guest.getByRole("button", { name: "Create passkey" }).click();
	await expect(guest.getByRole("alert").filter({ hasText: "Invalid invitation" })).toBeVisible();

	await guest.goto("/login");
	await guest.getByLabel("Email").fill("member@example.com");
	await guest.getByRole("button", { name: "Sign in with passkey" }).click();
	await expect(guest).toHaveURL("/");
	await expect(guest.getByRole("link", { name: "New app" })).toHaveCount(0);
	await guest.goto("/settings");
	await expect(guest.getByRole("navigation", { name: "Settings" }).getByRole("link")).toHaveText(["Account"]);
	expect((await guest.goto("/settings/audit")).status()).toBe(403);
	await other.close();

	// The administrator sees both events in the audit log.
	await page.goto("/settings/audit?action=user.create");
	await expect(page.locator("tbody")).toContainText("Invited someone");
	await expect(page.getByRole("status").filter({ hasText: "matching entry" })).toBeVisible();
	await page.goto("/settings/audit?action=auth.passkey.register");
	await expect(page.locator("tbody")).toContainText("Mia Member");
});

test("GitHub App manifest posts to GitHub with the panel's manifest", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings/github");
	// Development mode has no GitHub integration; production returns a manifest.
	await page.getByRole("button", { name: "Create GitHub App" }).click();
	await toast(page, "GitHub unavailable");
	await page.route("**/api/github/manifest", (route) => route.fulfill({ json: { action: "https://github.com/settings/apps/new?state=abc", manifest: { name: "NelcotaDeploy", url: "http://localhost" }, expires_at: new Date().toISOString() } }));
	let posted = null;
	await page.route("https://github.com/**", (route) => { posted = route.request(); route.fulfill({ body: "ok" }); });
	await page.getByRole("button", { name: "Create GitHub App" }).click();
	await expect.poll(() => posted && posted.url()).toBe("https://github.com/settings/apps/new?state=abc");
	expect(posted.method()).toBe("POST");
	expect(decodeURIComponent(posted.postData())).toContain('manifest={"name":"NelcotaDeploy"');
});

test("backups and updates under System", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings/backups");
	await expect(page).toHaveURL("/settings/platform#backups");
	await page.getByRole("button", { name: "Back up now" }).click();
	await toast(page, "Backup started.");
	// Operations have no event stream; the table polls until the job finishes.
	const status = page.locator("#operations tbody tr").first().locator("[data-status]");
	await expect(status).toHaveAttribute("data-status", /applied|failed/, { timeout: 30_000 });
	// Without a release identity the panel explains why it can't check for versions.
	await expect(page.locator("#updates")).toContainText("Automatic checks need a release identity");
	await page.getByText("Install a specific version").click();
	await page.getByLabel("Version").fill("v99.0.0");
	await page.getByRole("button", { name: "Update", exact: true }).click();
	await page.getByRole("dialog", { name: "Update the system?" }).getByRole("button", { name: "Start update" }).click();
	await toast(page, "Release identity not configured");
});

test("change a teammate's role and remove them", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings/users");
	await page.getByRole("button", { name: "Invite", exact: true }).click();
	await page.getByLabel("Email").fill("lee@example.com");
	await page.getByLabel("Name").fill("Lee");
	await page.getByRole("button", { name: "Create invitation" }).click();
	await expect(page.locator("#user-invite-result")).toContainText("Invitation for Lee");
	await page.reload();
	await page.getByLabel("Role for Lee").selectOption("admin");
	await toast(page, "Role changed to administrator.");
	await page.getByRole("button", { name: "Remove Lee" }).click();
	await page.getByRole("dialog", { name: "Remove Lee?" }).getByRole("button", { name: "Remove" }).click();
	await toast(page, "Removed.");
	await expect(page.locator("#team")).not.toContainText("lee@example.com");
});

test("notifications: save a webhook and email, then remove the webhook", async ({ page }) => {
	await newClient(page);
	await devLogin(page);
	await page.goto("/settings/github");
	const card = page.locator("#notifications");
	await card.getByLabel("Webhook address").fill("https://hooks.slack.com/services/T0/B0/secret-path");
	// Email is folded until it is configured.
	await card.locator("summary", { hasText: "Email" }).click();
	await card.getByLabel("SMTP server").fill("smtp.example.com");
	await card.getByLabel("From").fill("panel@example.com");
	await card.getByLabel("Send to").fill("ops@example.com");
	await card.getByLabel("A new version is available").uncheck();
	await card.getByRole("button", { name: "Save notifications" }).click();
	await toast(page, "Notifications saved.");
	await expect(card.locator(".status", { hasText: "Slack" })).toBeVisible();
	await expect(card.locator(".status", { hasText: "smtp.example.com" })).toBeVisible();
	await expect(card).not.toContainText("secret-path");
	await expect(card.getByLabel("A new version is available")).not.toBeChecked();
	await expect(card.getByLabel("Webhook address")).toHaveValue("");
	await card.getByRole("button", { name: "Remove" }).first().click();
	await toast(page, "Webhook removed.");
	await expect(card.locator(".status", { hasText: "Slack" })).toHaveCount(0);
});
