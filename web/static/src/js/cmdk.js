// Command palette: Ctrl/Cmd+K opens a filterable list of pages, apps, and actions.
(function () {
	"use strict";
	var dialog, input, list, empty, loaded = false, active = -1;

	function items() {
		return Array.prototype.filter.call(list.querySelectorAll("[role=option]"), function (el) { return !el.hidden; });
	}
	function select(i) {
		var all = items();
		// Clear hidden options too, so a filtered-out option never stays selected.
		list.querySelectorAll("[role=option]").forEach(function (el) { el.setAttribute("aria-selected", "false"); });
		active = all.length ? (i + all.length) % all.length : -1;
		if (active >= 0) {
			all[active].setAttribute("aria-selected", "true");
			input.setAttribute("aria-activedescendant", all[active].id);
			all[active].scrollIntoView({ block: "nearest" });
		} else {
			input.removeAttribute("aria-activedescendant");
		}
	}
	function filter() {
		var q = input.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
		list.querySelectorAll("[role=option]").forEach(function (el) {
			var text = (el.dataset.keywords || el.textContent).toLowerCase();
			el.hidden = !q.every(function (w) { return text.indexOf(w) >= 0; });
		});
		list.querySelectorAll("[data-group]").forEach(function (g) {
			g.hidden = !g.querySelector("[role=option]:not([hidden])");
		});
		empty.classList.toggle("hidden", items().length > 0);
		select(0);
	}
	// load fetches the commands once, then filters them by the current query.
	async function load() {
		if (!loaded) {
			try {
				var res = await fetch("/ui/cmdk", { credentials: "same-origin" });
				if (!res.ok) throw new Error();
				list.innerHTML = await res.text();
				loaded = true;
			} catch (e) {
				list.innerHTML = '<li class="p-3 text-sm text-destructive" role="alert"></li>';
				list.firstChild.textContent = window.Nelcota.t("Commands could not be loaded.");
			}
		}
		filter();
	}
	function open() {
		if (!dialog || dialog.open) return;
		input.value = "";
		dialog.showModal();
		input.focus();
		load();
	}
	// Options hold their target: data-href navigates; anything else runs the
	// option's own click behavior (a Datastar action or a delegated handler),
	// which a pointer click has already triggered.
	function run(el, clicked) {
		dialog.close();
		if (el.dataset.href) location.assign(el.dataset.href);
		else if (!clicked) el.click();
	}

	document.addEventListener("DOMContentLoaded", function () {
		dialog = document.getElementById("cmdk");
		if (!dialog) return;
		input = document.getElementById("cmdk-input");
		list = document.getElementById("cmdk-list");
		empty = document.getElementById("cmdk-empty");
		input.addEventListener("input", filter);
		input.addEventListener("keydown", function (e) {
			if (e.key === "ArrowDown") { e.preventDefault(); select(active + 1); }
			else if (e.key === "ArrowUp") { e.preventDefault(); select(active - 1); }
			else if (e.key === "Enter") {
				var all = items();
				if (active >= 0 && all[active]) { e.preventDefault(); run(all[active]); }
			}
		});
		list.addEventListener("mousemove", function (e) {
			var opt = e.target instanceof Element && e.target.closest("[role=option]");
			if (opt) select(items().indexOf(opt));
		});
		list.addEventListener("click", function (e) {
			var opt = e.target instanceof Element && e.target.closest("[role=option]");
			if (opt) run(opt, true);
		});
		dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
		document.querySelectorAll("[data-cmdk-open]").forEach(function (b) { b.addEventListener("click", open); });
		// Apple keyboards use Command for the shortcut, so name that key there.
		if (/Mac|iPhone|iPad/.test(navigator.platform)) {
			document.querySelectorAll("[data-cmdk-hint] kbd").forEach(function (k) { k.textContent = "⌘ K"; });
		}
	});
	document.addEventListener("keydown", function (e) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
			e.preventDefault();
			if (dialog && dialog.open) dialog.close(); else open();
		}
	});
})();
