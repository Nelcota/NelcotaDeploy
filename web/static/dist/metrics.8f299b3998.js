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
		var host = card.querySelector("[data-chart]"), details = card.querySelector("[data-chart-details]");
		var data = series[id];
		if (!data || data[0].length < 2 || (details && !details.open)) return;
		if (!window.uPlot) { uplot().then(function () { chart(id, card); }, function () {}); return; }
		var empty = host.querySelector("[data-chart-empty]");
		if (empty) empty.remove();
		if (charts[id]) { charts[id].setData(data); return; }
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
	function apps(card, m) {
		var rows = m.containers || [], sum = {};
		text(card, "containers-count", "· " + tr(rows.length === 1 ? "%d container" : "%d containers", rows.length));
		rows.forEach(function (c) {
			var a = sum[c.app_id] || (sum[c.app_id] = { cpu: 0, used: 0, limit: 0 });
			a.cpu += c.cpu_percent || 0; a.used += c.memory_used || 0; a.limit += c.memory_limit || 0;
		});
		card.querySelectorAll("[data-app]").forEach(function (li) {
			var a = sum[li.dataset.app], cpu = li.querySelector("[data-app-cpu]"), mem = li.querySelector("[data-app-memory]");
			if (cpu) cpu.textContent = a ? a.cpu.toFixed(1) + "%" : "—";
			if (mem) mem.textContent = a ? bytes(a.used) + " / " + bytes(a.limit) : "—";
		});
	}
	function meter(card, key, used, total) {
		var el = card.querySelector('[data-metric="' + key + '-meter"]'), p = pct(used, total);
		if (!el) return;
		el.value = total > 0 ? Math.min(1000, Math.round(used * 1000 / total)) : 0;
		el.setAttribute("aria-valuetext", tr("%d% used", p));
		if (p >= 90) el.dataset.level = "high"; else delete el.dataset.level;
	}
	function sample(d) {
		var card = document.querySelector('[data-server="' + CSS.escape(d.server_id) + '"]');
		if (!card) return;
		var m = d.metrics || {}, id = d.server_id, cpu = Math.min(100, m.cpu_percent || 0);
		text(card, "cpu", cpu.toFixed(1) + "%");
		meter(card, "cpu", cpu, 100);
		text(card, "memory", bytes(m.memory_used || 0));
		text(card, "memory-of", tr("of %s", bytes(m.memory_total || 0)));
		meter(card, "memory", m.memory_used || 0, m.memory_total || 0);
		text(card, "disk", bytes(m.disk_used || 0));
		text(card, "disk-of", tr("of %s", bytes(m.disk_total || 0)));
		meter(card, "disk", m.disk_used || 0, m.disk_total || 0);
		var cache = card.querySelector('[data-metric="cache-meter"]');
		if (cache && m.cache_used !== undefined) {
			text(card, "cache", bytes(m.cache_used || 0));
			meter(card, "cache", m.cache_used || 0, +cache.dataset.limit || 0);
		}
		apps(card, m);
		var s = series[id] || (series[id] = [[], [], []]);
		s[0].push(Date.now() / 1000); s[1].push(cpu); s[2].push(pct(m.memory_used || 0, m.memory_total || 0));
		if (s[0].length > MAX) s.forEach(function (a) { a.shift(); });
		chart(id, card);
	}
	document.addEventListener("toggle", function (e) {
		var card = e.target instanceof Element && e.target.matches("[data-chart-details]") && e.target.open && e.target.closest("[data-server]");
		if (card) chart(card.dataset.server, card);
	}, true);
	function offline(d) {
		var card = document.querySelector('[data-server="' + CSS.escape(d.id) + '"] [data-server-status] .status');
		if (card) { card.dataset.tone = "danger"; card.dataset.status = "offline"; card.textContent = tr("Offline"); }
	}
	document.addEventListener("nelcota:theme", function () {
		Object.keys(charts).forEach(function (id) { charts[id].destroy(); delete charts[id]; chart(id, document.querySelector('[data-server="' + CSS.escape(id) + '"]')); });
	});

	function state(name, text) { conn.dataset.state = name; conn.textContent = text; }
	window.Nelcota.stream("/api/events?topic=servers", { "server.metrics": sample, "server.offline": offline }, {
		open: function () { state("live", tr("Connected")); },
		reconnecting: function () { state("reconnecting", tr("Reconnecting…")); },
		signedOut: function () { state("offline", tr("Signed out")); },
	});
})();
