// GitHub App Manifest flow: the panel returns a manifest bound to this
// administrator; the browser posts it to GitHub, which creates the App.
(function () {
	"use strict";
	document.addEventListener("click", async function (e) {
		var b = e.target instanceof Element && e.target.closest("[data-github-manifest]");
		if (!b) return;
		b.disabled = true;
		try {
			var res = await window.Nelcota.api("POST", "/api/github/manifest");
			var form = document.createElement("form");
			form.method = "post";
			form.action = res.action;
			var input = document.createElement("input");
			input.type = "hidden";
			input.name = "manifest";
			input.value = JSON.stringify(res.manifest);
			form.append(input);
			document.body.append(form);
			form.submit();
		} catch (err) {
			if (err.status === 403) { var d = document.getElementById("reauth"); if (d) d.showModal(); }
			else window.Nelcota.toast("danger", err.message);
			b.disabled = false;
		}
	});
})();
