(function () {
	var t = null;
	try { t = localStorage.getItem("theme"); } catch (e) {}
	var dark = t === "dark" || (t !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
	document.documentElement.classList.toggle("dark", dark);
})();
