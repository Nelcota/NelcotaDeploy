// Image editor for profile photos and app logos: crop, zoom, rotate, flip, and
// color adjustments before anything is uploaded. app.js loads this file the
// first time someone picks an image on a page that renders the #image-editor
// dialog (pages.ImageEditor). The canvas is the exact output, so what the
// person sees is what gets sent; the server still decodes and re-encodes it.
(function () {
	"use strict";
	var dialog = document.getElementById("image-editor");
	var stage = dialog.querySelector("[data-editor-stage]");
	var canvas = stage.querySelector("canvas");
	var g = canvas.getContext("2d", { willReadFrequently: true });
	var inputs = {};
	dialog.querySelectorAll("input[data-editor]").forEach(function (el) { inputs[el.dataset.editor] = el; });
	var colors = ["brightness", "contrast", "saturation", "warmth"];
	// Presets only move the sliders, so their effect stays visible and adjustable.
	var presets = {
		original: {},
		mono: { saturation: -100, contrast: 10 },
		warm: { warmth: 50, saturation: 10 },
		cool: { warmth: -50 },
		vivid: { saturation: 45, contrast: 15 }
	};
	var src, logo, n, rot, flip, x, y, frame, done, drag;

	function val(k) { return +inputs[k].value; }
	function dims() { return rot % 180 ? [src.height, src.width] : [src.width, src.height]; }
	// Photos fill the square at zoom 1 (they are cropped); logos fit inside it
	// whole, keeping transparency, so wide wordmarks are not cut off.
	function scale() {
		var d = dims();
		return n / (logo ? Math.max(d[0], d[1]) : Math.min(d[0], d[1])) * val("zoom");
	}
	function clamp() {
		var d = dims(), s = scale(), mx = Math.max(0, (d[0] * s - n) / 2), my = Math.max(0, (d[1] * s - n) / 2);
		x = Math.min(mx, Math.max(-mx, x));
		y = Math.min(my, Math.max(-my, y));
	}
	// Color adjustments compose into one 3x4 matrix (rows: red, green, blue;
	// the last column is an offset), applied once per pixel.
	function mul(a, b) {
		var o = [];
		for (var r = 0; r < 12; r += 4) {
			for (var c = 0; c < 4; c++) o.push(a[r] * b[c] + a[r + 1] * b[4 + c] + a[r + 2] * b[8 + c] + (c == 3 ? a[r + 3] : 0));
		}
		return o;
	}
	function matrix() {
		var k = 1 + val("brightness") / 100, c = 1 + val("contrast") / 100, s = 1 + val("saturation") / 100;
		var w = val("warmth") / 100 * 0.15, o = 128 * (1 - c), R = 0.2126, G = 0.7152, B = 0.0722;
		var m = mul([c, 0, 0, o, 0, c, 0, o, 0, 0, c, o], [k, 0, 0, 0, 0, k, 0, 0, 0, 0, k, 0]);
		m = mul([R + (1 - R) * s, G - G * s, B - B * s, 0, R - R * s, G + (1 - G) * s, B - B * s, 0, R - R * s, G - G * s, B + (1 - B) * s, 0], m);
		return mul([1 + w, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1 - w, 0], m);
	}
	function render() {
		frame = 0;
		clamp();
		var s = scale(), w = src.width * s, h = src.height * s;
		g.setTransform(1, 0, 0, 1, 0, 0);
		g.clearRect(0, 0, n, n);
		// Photos become JPEGs, which have no transparency.
		if (!logo) { g.fillStyle = "#fff"; g.fillRect(0, 0, n, n); }
		g.translate(n / 2 + x, n / 2 + y);
		if (flip) g.scale(-1, 1);
		g.rotate(rot * Math.PI / 180);
		g.imageSmoothingQuality = "high";
		g.drawImage(src, -w / 2, -h / 2, w, h);
		if (colors.every(function (k) { return !val(k); })) return;
		var d = g.getImageData(0, 0, n, n), p = d.data, m = matrix();
		for (var i = 0; i < p.length; i += 4) {
			var r = p[i], gr = p[i + 1], b = p[i + 2];
			p[i] = m[0] * r + m[1] * gr + m[2] * b + m[3];
			p[i + 1] = m[4] * r + m[5] * gr + m[6] * b + m[7];
			p[i + 2] = m[8] * r + m[9] * gr + m[10] * b + m[11];
		}
		g.putImageData(d, 0, 0);
	}
	function draw() { if (!frame) frame = requestAnimationFrame(render); }
	// Sliders show their fill (Basecoat's --slider-value) and their value.
	function fill(el) {
		el.style.setProperty("--slider-value", (el.value - el.min) / (el.max - el.min) * 100 + "%");
		var out = dialog.querySelector('output[for="' + el.id + '"]');
		if (out) out.textContent = el.value;
	}
	function pick(name) {
		dialog.querySelectorAll("[data-editor-preset]").forEach(function (b) {
			b.setAttribute("aria-pressed", b.dataset.editorPreset == name);
		});
	}
	function preset(name) {
		colors.forEach(function (k) { inputs[k].value = presets[name][k] || 0; fill(inputs[k]); });
		pick(name);
		draw();
	}
	// Zooming keeps the point under the middle of the frame in place.
	function zoom(z) {
		var before = scale(), el = inputs.zoom;
		el.value = Math.min(+el.max, Math.max(+el.min, z));
		fill(el);
		x *= scale() / before;
		y *= scale() / before;
		draw();
	}
	function reset() {
		rot = 0;
		flip = false;
		x = y = 0;
		inputs.zoom.value = 1;
		fill(inputs.zoom);
		preset("original");
	}
	function finish(blob) {
		var d = done;
		done = null;
		if (dialog.open) dialog.close();
		if (d) d(blob);
	}
	// Very large camera photos are reduced once, so dragging stays smooth.
	async function load(file) {
		var b = await createImageBitmap(file), k = Math.min(1, 2048 / Math.max(b.width, b.height));
		if (k == 1) return b;
		var c = document.createElement("canvas");
		c.width = Math.round(b.width * k);
		c.height = Math.round(b.height * k);
		c.getContext("2d").drawImage(b, 0, 0, c.width, c.height);
		b.close();
		return c;
	}

	stage.addEventListener("pointerdown", function (e) {
		drag = [e.clientX, e.clientY];
		stage.setPointerCapture(e.pointerId);
	});
	stage.addEventListener("pointermove", function (e) {
		if (!drag) return;
		var k = n / stage.clientWidth;
		x += (e.clientX - drag[0]) * k;
		y += (e.clientY - drag[1]) * k;
		drag = [e.clientX, e.clientY];
		draw();
	});
	["pointerup", "pointercancel"].forEach(function (t) { stage.addEventListener(t, function () { drag = null; }); });
	stage.addEventListener("wheel", function (e) {
		e.preventDefault();
		zoom(val("zoom") * Math.exp(-e.deltaY / 500));
	}, { passive: false });
	stage.addEventListener("keydown", function (e) {
		var step = (e.shiftKey ? 40 : 8) * n / stage.clientWidth;
		var move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
		if (move) { x += move[0]; y += move[1]; draw(); }
		else if (e.key == "+" || e.key == "=") zoom(val("zoom") * 1.1);
		else if (e.key == "-") zoom(val("zoom") / 1.1);
		else return;
		e.preventDefault();
	});
	dialog.addEventListener("input", function (e) {
		var k = e.target.dataset.editor;
		if (!k) return;
		if (k == "zoom") { zoom(val("zoom")); return; }
		fill(e.target);
		pick("");
		draw();
	});
	dialog.addEventListener("click", function (e) {
		var b = e.target.closest("button");
		if (!b) return;
		if (b.dataset.editorPreset) { preset(b.dataset.editorPreset); return; }
		// Rotation follows what the person sees, also on a mirrored image.
		var a = b.dataset.editorAction, turn = { "rotate-left": -90, "rotate-right": 90 }[a];
		if (turn) { rot = (rot + (flip ? -turn : turn) + 360) % 360; x = y = 0; draw(); }
		else if (a == "flip") { flip = !flip; x = -x; draw(); }
		else if (a == "reset") reset();
		else if (a == "cancel") finish(null);
		else if (a == "save") {
			render();
			canvas.toBlob(function (blob) { finish(blob || undefined); }, logo ? "image/png" : "image/jpeg", 0.9);
		}
	});
	// Escape closes the dialog without saving.
	dialog.addEventListener("close", function () { finish(null); });

	// open resolves with the edited image, or null when the person cancels; it
	// rejects when the file is not a readable image.
	window.NelcotaEditor = async function (file, isLogo) {
		var image = await load(file);
		finish(null);
		src = image;
		logo = isLogo;
		n = logo ? 256 : 512;
		canvas.width = canvas.height = n;
		dialog.dataset.shape = logo ? "square" : "circle";
		reset();
		render();
		dialog.showModal();
		stage.focus({ preventScroll: true });
		return new Promise(function (resolve) { done = resolve; });
	};
})();
