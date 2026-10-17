// WebAuthn ceremonies for sign-in, enrollment, adding passkeys, and
// re-authentication. Challenges stay in memory; nothing secret is logged or stored.
(function () {
	"use strict";
	var N = window.Nelcota, tr = N.t;
	var PKC = window.PublicKeyCredential;

	function enc(buf) {
		var s = "", b = new Uint8Array(buf);
		for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
		return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	}
	function dec(str) {
		var s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
		var b = new Uint8Array(s.length);
		for (var i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
		return b.buffer;
	}
	function ids(list) {
		return (list || []).map(function (c) { return Object.assign({}, c, { id: dec(c.id) }); });
	}
	function creation(pk) {
		if (PKC.parseCreationOptionsFromJSON) return PKC.parseCreationOptionsFromJSON(pk);
		return Object.assign({}, pk, { challenge: dec(pk.challenge), user: Object.assign({}, pk.user, { id: dec(pk.user.id) }), excludeCredentials: ids(pk.excludeCredentials) });
	}
	function request(pk) {
		if (PKC.parseRequestOptionsFromJSON) return PKC.parseRequestOptionsFromJSON(pk);
		return Object.assign({}, pk, { challenge: dec(pk.challenge), allowCredentials: ids(pk.allowCredentials) });
	}
	function serialize(c) {
		try { if (c.toJSON) return c.toJSON(); } catch (e) {}
		var r = c.response, out = { id: c.id, rawId: enc(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), response: { clientDataJSON: enc(r.clientDataJSON) } };
		if (r.attestationObject) {
			out.response.attestationObject = enc(r.attestationObject);
			out.response.transports = r.getTransports ? r.getTransports() : [];
		} else {
			out.response.authenticatorData = enc(r.authenticatorData);
			out.response.signature = enc(r.signature);
			if (r.userHandle) out.response.userHandle = enc(r.userHandle);
		}
		return out;
	}
	function explain(e) {
		if (e && e.name === "NotAllowedError") return tr("The passkey prompt was dismissed or timed out.");
		if (e && e.name === "InvalidStateError") return tr("This passkey is already registered for this account.");
		if (e && e.name === "SecurityError") return tr("Passkeys need a secure origin with a domain name.");
		return (e && e.message) || tr("Something went wrong. Try again.");
	}
	function supported() { return !!(PKC && navigator.credentials); }

	async function login(email) {
		var c = await N.api("POST", "/api/auth/login/begin", { email: email });
		var cred = await navigator.credentials.get({ publicKey: request(c.options.publicKey) });
		return N.api("POST", "/api/auth/login/finish", { ceremony_id: c.ceremony_id, credential: serialize(cred) });
	}
	async function register(body) {
		var c = await N.api("POST", "/api/auth/register/begin", body);
		var cred = await navigator.credentials.create({ publicKey: creation(c.options.publicKey) });
		return N.api("POST", "/api/auth/register/finish", { ceremony_id: c.ceremony_id, credential: serialize(cred) });
	}
	function busy(button, on) {
		if (!button) return;
		button.disabled = on;
		button.setAttribute("aria-busy", on ? "true" : "false");
	}
	function show(el, on) { if (el) el.classList.toggle("hidden", !on); }
	function say(root, msg) { var el = root.querySelector("[data-auth-error]"); if (el) el.textContent = msg || ""; }
	function after(message) {
		try { sessionStorage.setItem("nelcota-toast", message); } catch (e) {}
	}

	function loginPage(root) {
		var form = root.querySelector("#login-form");
		var step = root.querySelector("#totp-step");
		var challenge = "";
		var next = root.dataset.next || "/";
		if (!supported()) say(root, tr("This browser does not support passkeys."));
		form.addEventListener("submit", async function (e) {
			e.preventDefault();
			var button = form.querySelector("button[type=submit]");
			busy(button, true);
			say(root, "");
			try {
				var res = await login(form.email.value.trim());
				if (res.requires_totp) {
					challenge = res.challenge;
					show(form, false);
					show(step, true);
					step.querySelector("#totp-code").focus();
				} else {
					location.assign(next);
				}
			} catch (err) {
				say(root, explain(err));
			} finally {
				busy(button, false);
			}
		});
		var recovery = false;
		var toggle = root.querySelector("[data-recovery-toggle]");
		toggle.addEventListener("click", function () {
			recovery = !recovery;
			show(root.querySelector("[data-totp-field]"), !recovery);
			show(root.querySelector("[data-recovery-field]"), recovery);
			toggle.textContent = recovery ? tr("Use an authenticator code") : tr("Use a recovery code");
			root.querySelector(recovery ? "#recovery-code" : "#totp-code").focus();
		});
		step.addEventListener("submit", async function (e) {
			e.preventDefault();
			var button = step.querySelector("button[type=submit]");
			busy(button, true);
			say(root, "");
			try {
				if (recovery) await N.api("POST", "/api/auth/recovery/verify", { challenge: challenge, code: step.querySelector("#recovery-code").value });
				else await N.api("POST", "/api/auth/totp/verify", { challenge: challenge, code: step.querySelector("#totp-code").value.trim() });
				location.assign(next);
			} catch (err) {
				// The challenge is consumed by any attempt; restart from the passkey step.
				say(root, explain(err) + " " + tr("Sign in with your passkey again."));
				show(step, false);
				show(form, true);
			} finally {
				busy(button, false);
			}
		});
		var dev = root.querySelector("#dev-login");
		if (dev) dev.addEventListener("click", async function () {
			busy(dev, true);
			try { await N.api("POST", "/api/dev/session", {}); location.assign(next); }
			catch (err) { say(root, explain(err)); busy(dev, false); }
		});
	}

	function enrollPage(root) {
		var form = root.querySelector("#enroll-form");
		// Emailed invitations carry the token in the fragment, which never reaches a server.
		var m = location.hash.match(/^#token=([A-Za-z0-9_%-]{1,512})$/);
		if (m) {
			form.token.value = decodeURIComponent(m[1]);
			history.replaceState(null, "", location.pathname);
		}
		if (!supported()) say(root, tr("This browser does not support passkeys."));
		form.addEventListener("submit", async function (e) {
			e.preventDefault();
			var button = form.querySelector("button[type=submit]");
			busy(button, true);
			say(root, "");
			try {
				await register({ enrollment_token: form.token.value.trim() });
				form.reset();
				show(form, false);
				show(root.querySelector("#enroll-done"), true);
				root.querySelector("#enroll-done a").focus();
			} catch (err) {
				say(root, explain(err));
			} finally {
				busy(button, false);
			}
		});
	}

	function openReauth() {
		var d = document.getElementById("reauth");
		if (d && !d.open) d.showModal();
	}
	// Other scripts ask for re-authentication when the server answers 403.
	N.reauth = openReauth;

	document.addEventListener("DOMContentLoaded", function () {
		var root = document.querySelector("[data-auth]");
		if (root && root.dataset.auth === "login") loginPage(root);
		if (root && root.dataset.auth === "enroll") enrollPage(root);
	});

	var reauthChallenge = "";
	document.addEventListener("click", async function (e) {
		var t = e.target instanceof Element ? e.target : null;
		if (!t) return;
		var add = t.closest("[data-add-passkey]");
		if (add) {
			busy(add, true);
			try {
				await register({});
				after(tr("Passkey added."));
				location.reload();
			} catch (err) {
				if (err.status === 403) openReauth();
				else N.toast("danger", explain(err));
			} finally {
				busy(add, false);
			}
			return;
		}
		var re = t.closest("[data-reauth]");
		if (!re) return;
		var box = re.closest("[data-reauth-root]");
		var err = box.querySelector("[data-reauth-error]");
		var totp = box.querySelector("[data-reauth-totp]");
		busy(re, true);
		err.textContent = "";
		try {
			if (reauthChallenge) {
				await N.api("POST", "/api/auth/totp/verify", { challenge: reauthChallenge, code: box.querySelector("#reauth-code").value.trim() });
			} else {
				var res = await login(box.dataset.email);
				if (res.requires_totp) {
					reauthChallenge = res.challenge;
					show(totp, true);
					re.lastChild.textContent = " " + tr("Verify code");
					box.querySelector("#reauth-code").focus();
					return;
				}
			}
			// A new session cookie also rotates the CSRF token, so reload the page.
			after(tr("Identity confirmed. Run the action again."));
			location.reload();
		} catch (x) {
			reauthChallenge = "";
			show(totp, false);
			err.textContent = explain(x);
		} finally {
			busy(re, false);
		}
	});
})();
