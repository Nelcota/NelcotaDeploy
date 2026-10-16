// Shared panel behavior: theme, clipboard, sign-out, secret reveal, countdowns, toasts.
(function () {
	"use strict";
	var root = document.documentElement;

	// tr translates interface text with the catalog the page embeds for scripts
	// (#i18n, absent in English), then fills %s and %d with the extra arguments.
	var dict;
	function catalog() {
		if (!dict) {
			try { dict = JSON.parse((document.getElementById("i18n") || {}).textContent || "{}"); } catch (e) { dict = {}; }
		}
		return dict;
	}
	function tr(s) {
		var args = arguments, i = 1, d = catalog();
		return (d[s] !== undefined ? d[s] : s).replace(/%[sd]/g, function (m) { return i < args.length ? String(args[i++]) : m; });
	}
	var media = matchMedia("(prefers-color-scheme: dark)");

	function csrf() {
		var m = document.querySelector('meta[name="csrf-token"]');
		return m ? m.content : "";
	}
	function stored() {
		try { return localStorage.getItem("theme") || "system"; } catch (e) { return "system"; }
	}
	function apply(choice) {
		root.classList.toggle("dark", choice === "dark" || (choice === "system" && media.matches));
		document.querySelectorAll("[data-theme-toggle]").forEach(function (b) { b.setAttribute("aria-pressed", root.classList.contains("dark") ? "true" : "false"); });
		document.querySelectorAll("[data-theme-select]").forEach(function (o) { o.value = choice; });
		document.dispatchEvent(new CustomEvent("nelcota:theme"));
	}
	function choose(choice) {
		try { localStorage.setItem("theme", choice); } catch (e) {}
		apply(choice);
	}
	media.addEventListener("change", function () { if (stored() === "system") apply("system"); });

	function toast(tone, message) {
		var host = document.getElementById("toaster");
		if (!host) return;
		var el = document.createElement("div");
		el.className = "toast";
		el.dataset.tone = tone;
		el.setAttribute("role", tone === "danger" ? "alert" : "status");
		var p = document.createElement("p");
		p.className = "flex-1";
		p.textContent = message;
		var b = document.createElement("button");
		b.type = "button";
		b.className = "btn";
		b.dataset.variant = "ghost";
		b.dataset.size = "xs";
		b.textContent = tr("Dismiss");
		b.onclick = function () { el.remove(); };
		el.append(p, b);
		host.append(el);
		setTimeout(function () { el.remove(); }, 6000);
	}

	// JSON request helper for the documented /api endpoints (authentication flows).
	async function api(method, url, body) {
		var headers = { "Content-Type": "application/json" };
		var token = csrf();
		if (token) headers["X-CSRF-Token"] = token;
		var res = await fetch(url, { method: method, headers: headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
		var data = null;
		try { data = await res.json(); } catch (e) {}
		if (!res.ok) {
			var err = new Error(tr((data && data.message) || (res.status === 429 ? "Too many attempts. Wait a moment and try again." : "Request failed")));
			err.status = res.status;
			err.code = data && data.code;
			throw err;
		}
		return data;
	}

	function pad(n) { return n < 10 ? "0" + n : "" + n; }
	function tick() {
		var now = Date.now();
		document.querySelectorAll("[data-expires]").forEach(function (el) {
			var left = Math.max(0, Math.floor((Date.parse(el.dataset.expires) - now) / 1000));
			el.textContent = left > 0 ? tr("%s remaining", Math.floor(left / 60) + ":" + pad(left % 60)) : tr("Expired");
			el.classList.toggle("text-destructive", left === 0);
		});
	}
	setInterval(tick, 1000);

	// "g" then a letter opens a primary destination (the rail links declare
	// aria-keyshortcuts="g h" and so on). Ignored while typing or with modifiers.
	var pendingG = 0;
	document.addEventListener("keydown", function (e) {
		if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
		var el = e.target instanceof Element ? e.target : null;
		if (el && el.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
		var key = e.key.toLowerCase();
		if (pendingG && Date.now() - pendingG < 1200) {
			pendingG = 0;
			var link = document.querySelector('a[aria-keyshortcuts="g ' + CSS.escape(key) + '"]');
			if (link) { e.preventDefault(); location.assign(link.href); }
			return;
		}
		pendingG = key === "g" ? Date.now() : 0;
	});

	// Menus built on <details> close on an outside click or Escape.
	function closeMenus(except) {
		document.querySelectorAll("details.menu[open]").forEach(function (d) { if (d !== except) d.open = false; });
	}
	document.addEventListener("keydown", function (e) {
		if (e.key !== "Escape") return;
		var open = document.querySelector("details.menu[open]");
		if (open) { open.open = false; open.querySelector("summary").focus(); }
	});

	document.addEventListener("click", async function (e) {
		var t = e.target instanceof Element ? e.target : null;
		if (!t) return;
		closeMenus(t.closest("details.menu"));
		var copy = t.closest("[data-copy]");
		if (copy) {
			var src = document.getElementById(copy.dataset.copy);
			try {
				await navigator.clipboard.writeText(src ? src.textContent.trim() : "");
				toast("success", tr("Copied to clipboard"));
			} catch (err) {
				toast("danger", tr("Copy failed. Select the text and copy it manually."));
			}
			return;
		}
		var reveal = t.closest("[data-reveal]");
		if (reveal) {
			var input = document.getElementById(reveal.dataset.reveal);
			if (!input) return;
			var show = input.type === "password";
			input.type = show ? "text" : "password";
			reveal.setAttribute("aria-pressed", show ? "true" : "false");
			reveal.setAttribute("aria-label", show ? tr("Hide value") : tr("Show value"));
			return;
		}
		var theme = t.closest("[data-theme-set]");
		if (theme) { choose(theme.dataset.themeSet); return; }
		if (t.closest("[data-theme-toggle]")) { choose(root.classList.contains("dark") ? "light" : "dark"); return; }
		if (t.closest("[data-logout]")) {
			try { await api("POST", "/api/auth/logout"); } catch (err) {}
			location.assign("/login");
		}
	});

	document.addEventListener("DOMContentLoaded", function () {
		tick();
		try {
			var pending = sessionStorage.getItem("nelcota-toast");
			if (pending) { sessionStorage.removeItem("nelcota-toast"); toast("success", pending); }
		} catch (e) {}
		apply(stored());
		document.querySelectorAll("[data-theme-select]").forEach(function (sel) {
			sel.addEventListener("change", function () { choose(sel.value); });
		});
	});

	// tc translates a word in a context (see i18n.TC).
	function tc(context, s) {
		var k = context + "|" + s;
		return catalog()[k] !== undefined ? catalog()[k] : tr(s);
	}
	// Profile photos: crop and shrink the chosen image to 512 px in the browser so
	// uploads stay small (the server still re-encodes it), then submit.
	async function shrink(file) {
		var b = await createImageBitmap(file), side = Math.min(b.width, b.height), n = Math.min(512, side);
		var c = document.createElement("canvas"), g = c.getContext("2d");
		c.width = c.height = n;
		g.fillStyle = "#fff";
		g.fillRect(0, 0, n, n);
		g.drawImage(b, (b.width - side) / 2, (b.height - side) / 2, side, side, 0, 0, n, n);
		return new Promise(function (resolve) { c.toBlob(resolve, "image/jpeg", 0.9); });
	}
	// App logos: fit the whole image into a transparent 256 px square, keeping
	// transparency, so wide wordmarks aren't cut off.
	async function fit(file) {
		var b = await createImageBitmap(file), n = Math.min(256, Math.max(b.width, b.height));
		var scale = n / Math.max(b.width, b.height), w = b.width * scale, h = b.height * scale;
		var c = document.createElement("canvas");
		c.width = c.height = n;
		c.getContext("2d").drawImage(b, (n - w) / 2, (n - h) / 2, w, h);
		return new Promise(function (resolve) { c.toBlob(resolve, "image/png"); });
	}
	document.addEventListener("change", async function (e) {
		var input = e.target instanceof HTMLInputElement && e.target.matches("[data-avatar-input], [data-logo-input]") ? e.target : null;
		if (!input || !input.files || !input.files[0]) return;
		var logo = input.matches("[data-logo-input]"), blob;
		try { blob = await (logo ? fit : shrink)(input.files[0]); } catch (err) { blob = null; }
		if (!blob) {
			input.value = "";
			toast("danger", tr("This image can't be read. Use a JPEG, PNG, or WebP image."));
			return;
		}
		var files = new DataTransfer();
		files.items.add(logo ? new File([blob], "logo.png", { type: "image/png" }) : new File([blob], "photo.jpg", { type: "image/jpeg" }));
		input.files = files.files;
		input.form.requestSubmit();
	});
	window.Nelcota = { api: api, csrf: csrf, toast: toast, t: tr, tc: tc };
})();
