// Live server metrics on the servers page: numbers, disk meter, container table,
// and a uPlot chart per server built from samples received since the page opened.
// uPlot is loaded only when the first chart has two samples to draw, so the
// page itself stays light.
(function () {
	"use strict";
	var tr = window.Nelcota.t;
	var list = document.getElementById("servers-list");
	if (!list) return;
	var names = {};
	try { names = JSON.parse(list.dataset.apps || "{}"); } catch (e) {}
	var conn = document.getElementById("metrics-conn");
	var MAX = 240; // one hour at 15-second samples
	var series = {}, charts = {};

	function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
	function bytes(n) {
		var u = ["B", "KiB", "MiB", "GiB", "TiB"], i = 0;
		while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
		return (i ? n.toFixed(1) : n) + " " + u[i];
	}
	function pct(a, b) { return b > 0 ? Math.round((a / b) * 100) : 0; }
	function text(card, key, value) {
		var el = card.querySelector('[data-metric="' + key + '"]');
		if (el) el.textContent = value;
	}
	var plot;
	function uplot() {
		return plot || (plot = new Promise(function (done, fail) {
			var s = document.createElement("script");
			s.src = list.dataset.uplot;
			s.onload = done;
			s.onerror = function () { plot = null; fail(); };
			document.head.append(s);
		}));
	}
	function chart(id, card) {
		var host = card.querySelector("[data-chart]");
		var data = series[id];
		if (data[0].length < 2) return;
		if (!window.uPlot) { uplot().then(function () { chart(id, card); }, function () {}); return; }
		var empty = host.querySelector("[data-chart-empty]");
		if (empty) empty.remove();
		if (charts[id]) { charts[id].setData(data); return; }
		// A quiet chart: CPU in the brand color, memory as a neutral dashed line,
		// one 50% guide line, and sparse time labels.
		var axis = { stroke: css("--muted-foreground"), grid: { stroke: css("--border"), width: 1 }, ticks: { show: false }, font: "11px system-ui, sans-serif" };
		var line = { width: 1.5, points: { show: false } };
		charts[id] = new uPlot({
			width: host.clientWidth, height: host.clientHeight, legend: { show: false }, cursor: { points: { size: 5 } },
			scales: { x: { time: true }, y: { range: [0, 100] } },
			axes: [
				Object.assign({}, axis, { grid: { show: false }, space: 90, size: 24, values: function (u, v) { return v.map(function (t) { return new Date(t * 1e3).toTimeString().slice(0, 8); }); } }),
				Object.assign({}, axis, { splits: function () { return [50]; }, values: function () { return ["50%"]; }, size: 36 }),
			],
			series: [{}, Object.assign({ stroke: css("--primary"), fill: css("--primary") + "1f" }, line), Object.assign({ stroke: css("--muted-foreground"), dash: [4, 3] }, line)],
		}, data, host);
		new ResizeObserver(function () { charts[id] && charts[id].setSize({ width: host.clientWidth, height: host.clientHeight }); }).observe(host);
	}
	function containers(card, m) {
		var body = card.querySelector("[data-containers]");
		var rows = (m.containers || []).slice().sort(function (a, b) { return (b.cpu_percent || 0) - (a.cpu_percent || 0); });
		text(card, "containers-count", "(" + rows.length + ")");
		body.replaceChildren.apply(body, rows.length ? rows.map(function (c) {
			var row = document.createElement("tr");
			[names[c.app_id] || c.app_id || tr("Unknown"), (c.cpu_percent || 0).toFixed(1) + "%", bytes(c.memory_used || 0) + " / " + bytes(c.memory_limit || 0), String(c.pids || 0)].forEach(function (v, i) {
				var td = document.createElement("td");
				td.textContent = v;
				if (i > 0) td.className = "tabular-nums";
				row.append(td);
			});
			return row;
		}) : [(function () { var row = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 4; td.className = "text-muted-foreground"; td.textContent = tr("No containers running."); row.append(td); return row; })()]);
	}
	function sample(d) {
		var card = document.querySelector('[data-server="' + CSS.escape(d.server_id) + '"]');
		if (!card) return;
		var m = d.metrics || {}, id = d.server_id;
		var mem = pct(m.memory_used || 0, m.memory_total || 0), disk = pct(m.disk_used || 0, m.disk_total || 0);
		text(card, "cpu", (m.cpu_percent || 0).toFixed(1) + "%");
		text(card, "memory", bytes(m.memory_used || 0) + " / " + bytes(m.memory_total || 0) + " (" + mem + "%)");
		text(card, "disk", bytes(m.disk_used || 0) + " / " + bytes(m.disk_total || 0) + " (" + disk + "%)");
		var meter = card.querySelector('[data-metric="disk-meter"]');
		meter.value = disk * 10;
		meter.setAttribute("aria-valuetext", tr("%d% used", disk));
		if (disk >= 90) meter.dataset.level = "high"; else delete meter.dataset.level;
		var cache = card.querySelector('[data-metric="cache-meter"]');
		if (cache && m.cache_used !== undefined) {
			var limit = +cache.dataset.limit || 0;
			text(card, "cache", tr("%s of %s", bytes(m.cache_used || 0), bytes(limit)));
			cache.value = limit ? Math.min(1000, Math.round((m.cache_used || 0) * 1000 / limit)) : 0;
		}
		containers(card, m);
		var s = series[id] || (series[id] = [[], [], []]);
		s[0].push(Date.now() / 1000); s[1].push(Math.min(100, m.cpu_percent || 0)); s[2].push(mem);
		if (s[0].length > MAX) s.forEach(function (a) { a.shift(); });
		chart(id, card);
	}
	function offline(d) {
		var card = document.querySelector('[data-server="' + CSS.escape(d.id) + '"] [data-server-status] .status');
		if (card) { card.dataset.tone = "danger"; card.dataset.status = "offline"; card.textContent = tr("Offline"); }
	}
	document.addEventListener("nelcota:theme", function () {
		// Rebuild charts with the new theme's colors.
		Object.keys(charts).forEach(function (id) { charts[id].destroy(); delete charts[id]; chart(id, document.querySelector('[data-server="' + CSS.escape(id) + '"]')); });
	});

	function state(name, text) { conn.dataset.state = name; conn.textContent = text; }
	window.Nelcota.stream("/api/events?topic=servers", { "server.metrics": sample, "server.offline": offline }, {
		open: function () { state("live", tr("Connected")); },
		reconnecting: function () { state("reconnecting", tr("Reconnecting…")); },
		signedOut: function () { state("offline", tr("Signed out")); },
	});
})();
