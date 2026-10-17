// Build and runtime log viewer on xterm.js. Build logs load the persisted
// snapshot, then follow /api/events; runtime logs only follow. Writes are batched
// per animation frame so tens of thousands of lines stay responsive.
(function () {
	"use strict";
	var el = document.getElementById("terminal");
	if (!el || !window.Terminal) return;
	var N = window.Nelcota, tr = N.t;
	var mode = el.dataset.mode, topic = el.dataset.topic;
	var term = new Terminal({
		convertEol: true, disableStdin: true, scrollback: 50000, fontSize: 12.5, lineHeight: 1.2,
		fontFamily: 'ui-monospace, "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace',
		cursorStyle: "bar", cursorInactiveStyle: "none", allowProposedApi: false,
		theme: { background: "#0b0d10", foreground: "#e5e7eb", selectionBackground: "#3b82f699", cursor: "#0b0d10" },
	});
	var fit = new FitAddon.FitAddon();
	term.loadAddon(fit);
	term.open(el);
	fit.fit();
	new ResizeObserver(function () { try { fit.fit(); } catch (e) {} }).observe(el);

	var lines = [], partial = "", queue = [], held = [], heldLines = 0, paused = false, follow = true, scheduled = false;
	var MAX_LINES = 200000;
	var conn = document.getElementById("log-conn");
	var heldNote = document.getElementById("log-held");

	function state(s, text) {
		conn.dataset.state = s;
		conn.textContent = text;
	}
	function record(text) {
		var parts = (partial + text).split("\n");
		partial = parts.pop();
		for (var i = 0; i < parts.length; i++) lines.push(parts[i]);
		if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
	}
	// The box grows with the content; CSS caps it (.log-view).
	function size() {
		var b = term.buffer.active, row = el.querySelector(".xterm-rows > div");
		el.style.setProperty("--log-lines", b.baseY + b.cursorY + (b.cursorX ? 1 : 0));
		if (row && row.offsetHeight) el.style.setProperty("--log-cell", row.offsetHeight + "px");
	}
	// Color plain lines: errors red, warnings amber, the [stage] prefix in the
	// brand color. Lines that already carry ANSI colors are left alone.
	var red = "\x1b[38;2;248;113;113m", amber = "\x1b[38;2;251;191;36m", green = "\x1b[38;2;131;232;176m", off = "\x1b[0m";
	function paint(text) {
		return text.replace(/^[^\n\x1b]+$/gm, function (l) {
			if (/\b(error|failed|fatal|panic)\b/i.test(l)) return red + l + off;
			if (/\bwarn(ing)?\b/i.test(l)) return amber + l + off;
			return l.replace(/^\[[\w.-]+\]/, function (p) { return green + p + off; });
		});
	}
	function flush() {
		scheduled = false;
		if (!queue.length) return;
		// Bound each write so a 4 MiB snapshot does not block the main thread.
		var chunk = "", n = 0;
		while (queue.length && n < 262144) { var s = queue.shift(); chunk += s; n += s.length; }
		term.write(paint(chunk), function () {
			size();
			if (follow) term.scrollToBottom();
			if (queue.length) schedule();
		});
	}
	function schedule() {
		if (!scheduled) { scheduled = true; requestAnimationFrame(flush); }
	}
	function write(text) {
		record(text);
		if (paused) {
			held.push(text);
			heldLines += (text.match(/\n/g) || []).length;
			heldNote.textContent = tr(heldLines === 1 ? "%d new line arrived while paused." : "%d new lines arrived while paused.", heldLines);
			heldNote.classList.remove("hidden");
			return;
		}
		for (var i = 0; i < text.length; i += 65536) queue.push(text.slice(i, i + 65536));
		schedule();
	}
	function reset() {
		term.reset();
		lines = []; partial = ""; queue = []; held = []; heldLines = 0;
		size();
	}

	// Stop following when the user scrolls up; resume when they reach the bottom.
	el.addEventListener("wheel", function (e) { if (e.deltaY < 0 && follow) setFollow(false); }, { passive: true });
	term.onScroll(function () {
		var b = term.buffer.active, atBottom = b.viewportY >= b.baseY;
		if (follow !== atBottom && !queue.length) setFollow(atBottom);
	});
	function press(name, on) {
		var b = document.querySelector('[data-log="' + name + '"]');
		if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
		return b;
	}
	function setFollow(on) {
		follow = on;
		press("follow", on);
		if (on) term.scrollToBottom();
	}

	var statusEl = document.getElementById("log-status");
	var labels = { queued: [tr("Waiting"), "warning"], building: [tr("Building"), "progress"], starting: [tr("Starting"), "progress"], success: [tr("Published"), "success"], failed: [tr("Failed"), "danger"], cancelled: [tr("Cancelled"), "muted"] };
	function terminal(s) { return s === "success" || s === "failed" || s === "cancelled"; }
	function showStatus(s) {
		if (!statusEl || !labels[s]) return;
		statusEl.dataset.status = s;
		statusEl.dataset.tone = labels[s][1];
		statusEl.textContent = labels[s][0];
	}

	var live = null, finished = mode === "build" && terminal(el.dataset.status), connectedOnce = false;
	function snapshot() {
		return fetch("/api/deployments/" + encodeURIComponent(el.dataset.deployment) + "/logs", { credentials: "same-origin" })
			.then(function (r) { if (!r.ok) throw r; return r.json(); })
			.then(function (d) { return d.text || ""; });
	}
	function connect() {
		state("connecting", tr("Connecting…"));
		var buffered = [], ready = mode === "runtime";
		live = N.stream("/api/events?topic=" + encodeURIComponent(topic), {
			"deploy.log": function (d) { ready ? write(d.line) : buffered.push(d.line); },
			"runtime.log": function (d) { write(d.line); },
			"deploy.status": function (d) {
				showStatus(d.status);
				if (terminal(d.status)) { finished = true; live.close(); state("done", tr("Finished")); }
			},
		}, {
			open: function () {
				state("live", tr("Connected"));
				if (mode === "runtime") {
					if (connectedOnce) write("\x1b[2m[" + tr("reconnected; lines sent while offline are missing") + "]\x1b[0m\n");
					connectedOnce = true;
					return;
				}
				// Load the persisted snapshot after subscribing, then append buffered lines
				// that are not already part of the snapshot's tail.
				ready = false;
				snapshot().then(function (text) {
					reset();
					write(text);
					var tail = new Set(text.split("\n").slice(-2000));
					buffered.forEach(function (l) { if (!tail.has(l.replace(/\n$/, ""))) write(l); });
					buffered = [];
					ready = true;
				}).catch(function () { write("\x1b[31m" + tr("The stored log could not be loaded.") + "\x1b[0m\n"); ready = true; });
			},
			reconnecting: function () { state("reconnecting", tr("Reconnecting…")); },
			signedOut: function () {
				state("offline", tr("Signed out"));
				N.toast("danger", tr("Your session ended. Sign in again to keep following logs."));
			},
		});
	}

	if (finished) {
		// A finished build only needs its stored log.
		state("done", tr("Finished"));
		snapshot().then(write).catch(function () { write("\x1b[31m" + tr("The stored log could not be loaded.") + "\x1b[0m\n"); });
	} else {
		connect();
	}

	// Search the terminal buffer and select matches one at a time.
	var search = document.getElementById("log-search"), counter = document.getElementById("log-matches"), matches = [], current = -1, timer;
	function find() {
		var q = search.value.toLowerCase();
		matches = []; current = -1;
		if (q) {
			var b = term.buffer.active;
			for (var y = 0; y < b.length; y++) {
				var line = b.getLine(y);
				if (!line) continue;
				var text = line.translateToString(true).toLowerCase(), x = text.indexOf(q);
				while (x >= 0) { matches.push([y, x]); x = text.indexOf(q, x + q.length); }
			}
		}
		counter.textContent = q ? (matches.length ? tr(matches.length === 1 ? "%d match" : "%d matches", matches.length) : tr("No matches")) : "";
		if (!q) term.clearSelection();
	}
	function go(step) {
		if (!matches.length) { find(); if (!matches.length) return; }
		current = (current + step + matches.length) % matches.length;
		var m = matches[current];
		setFollow(false);
		term.select(m[1], m[0], search.value.length);
		term.scrollToLine(Math.max(0, m[0] - Math.floor(term.rows / 2)));
		counter.textContent = tr("%d of %d", current + 1, matches.length);
	}
	search.addEventListener("input", function () { clearTimeout(timer); timer = setTimeout(find, 150); });
	search.addEventListener("keydown", function (e) {
		if (e.key === "Enter") { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
		if (e.key === "Escape") { search.value = ""; find(); }
	});

	document.addEventListener("click", function (e) {
		var b = e.target instanceof Element && e.target.closest("[data-log]");
		if (!b) return;
		switch (b.dataset.log) {
		case "next": go(1); break;
		case "prev": go(-1); break;
		case "follow": setFollow(!follow); break;
		case "pause":
			paused = !paused;
			press("pause", paused).querySelector("span").textContent = paused ? tr("Resume") : tr("Pause");
			if (!paused) {
				queue = queue.concat(held); held = []; heldLines = 0;
				heldNote.classList.add("hidden");
				schedule();
			}
			break;
		case "clear": reset(); find(); break;
		case "download":
			var blob = new Blob([lines.join("\n") + (partial ? "\n" + partial : "") + "\n"], { type: "text/plain" });
			var a = document.createElement("a");
			a.href = URL.createObjectURL(blob);
			a.download = el.dataset.file || "logs.log";
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
			break;
		}
	});

	// Hook for end-to-end tests and debugging; exposes no data beyond the page.
	window.NelcotaLogs = { lines: function () { return lines.length; }, pending: function () { return queue.length; } };
})();
