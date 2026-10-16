const crypto = require("node:crypto");
const { expect } = require("@playwright/test");

// Adds a CTAP2 platform authenticator with user verification, like a phone or laptop.
async function virtualAuthenticator(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("WebAuthn.enable");
	const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
		options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
	});
	return { cdp, authenticatorId };
}

async function devLogin(page) {
	await page.goto("/login");
	await page.getByRole("button", { name: "Continue as development administrator" }).click();
	await expect(page).toHaveURL("/");
}

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for a base32 secret.
function totp(secret, offset = 0) {
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
	let bits = "";
	for (const c of secret.replace(/[\s=]/g, "").toUpperCase()) bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
	const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
	const counter = Buffer.alloc(8);
	counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30) + offset));
	const h = crypto.createHmac("sha1", key).update(counter).digest();
	const o = h[h.length - 1] & 15;
	return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

// Waits for the next 30-second window so a fresh TOTP code is accepted after a used one.
async function nextWindow(page) {
	const left = 30 - (Math.floor(Date.now() / 1000) % 30);
	await page.waitForTimeout((left + 1) * 1000);
}

// The panel rate-limits /api/auth per client IP and trusts X-Forwarded-For from
// loopback (as behind Caddy). Long flows switch to a fresh documentation address
// instead of sleeping through the limiter.
let clients = 0;
async function newClient(page) {
	clients++;
	await page.setExtraHTTPHeaders({ "X-Forwarded-For": `198.51.100.${clients % 250}` });
}

// signOut uses the account menu in the sidebar.
async function signOut(page) {
	await page.getByRole("complementary", { name: "Sidebar" }).getByLabel("Account menu").click();
	await page.getByRole("button", { name: "Sign out" }).first().click();
}

async function toast(page, text) {
	await expect(page.locator("#toaster").getByText(text)).toBeVisible();
}

module.exports = { virtualAuthenticator, devLogin, totp, nextWindow, toast, newClient, signOut };
