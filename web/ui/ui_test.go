package ui

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/a-h/templ"
)

func markup(t *testing.T, c templ.Component) string {
	t.Helper()
	var b strings.Builder
	if err := c.Render(context.Background(), &b); err != nil {
		t.Fatal(err)
	}
	return b.String()
}

func TestStatusUsesTextAndTone(t *testing.T) {
	for status, want := range map[string][2]string{"success": {"success", "Published"}, "failed": {"danger", "Failed"}, "building": {"progress", "Building"}, "queued": {"warning", "Waiting"}, "cancelled": {"muted", "Cancelled"}, "not_ready": {"warning", "Recovering"}, "": {"muted", "Not published"}} {
		out := markup(t, Status(status))
		if !strings.Contains(out, `data-tone="`+want[0]+`"`) || !strings.Contains(out, ">"+want[1]+"<") {
			t.Fatal(status, out)
		}
	}
}

func TestToastRolesAndEscaping(t *testing.T) {
	danger := markup(t, Toast("danger", `<b>bad</b>`))
	if !strings.Contains(danger, `role="alert"`) || strings.Contains(danger, "<b>") || !strings.Contains(danger, "&lt;b&gt;") {
		t.Fatal(danger)
	}
	if ok := markup(t, Toast("success", "Saved")); !strings.Contains(ok, `role="status"`) || !strings.Contains(ok, `aria-label="Dismiss notification"`) {
		t.Fatal(ok)
	}
}

func TestConfirmDialogIsLabelledAndRunsAction(t *testing.T) {
	out := markup(t, ConfirmDialog("stop", "Stop app?", "It stops serving.", "Stop", Post("/ui/apps/x/action/stop"), true))
	for _, want := range []string{`<dialog id="stop"`, `aria-labelledby="stop-title"`, `aria-describedby="stop-body"`, `data-variant="destructive"`, `>Go back<`, "@post(&#34;/ui/apps/x/action/stop&#34;,{headers:{&#39;X-CSRF-Token&#39;:$_csrf}})"} {
		if !strings.Contains(out, want) {
			t.Fatal(want, out)
		}
	}
}

func TestFieldLinksLabelAndError(t *testing.T) {
	out := markup(t, Field("Name", "name", "Hint", "Required"))
	for _, want := range []string{`for="name"`, `id="name-hint"`, `id="name-error"`, `role="alert"`, "Required"} {
		if !strings.Contains(out, want) {
			t.Fatal(want, out)
		}
	}
}

func TestExpressionsEscapeValues(t *testing.T) {
	got := Post(`/ui/x");alert(1);("`)
	if strings.Contains(got, `x");alert`) || !strings.Contains(got, `"/ui/x\");alert(1);(\""`) {
		t.Fatal(got)
	}
	if JS("</script>") != `"\u003c/script\u003e"` {
		t.Fatal(JS("</script>"))
	}
	if !strings.Contains(PostForm("/a"), "contentType:'form'") || !strings.Contains(Stream("/s"), "retry:'always'") {
		t.Fatal("options")
	}
}

func TestIcons(t *testing.T) {
	out := markup(t, Icon("arrow-up-from-line", "size-5"))
	if !strings.HasPrefix(out, "<svg") || !strings.Contains(out, `aria-hidden="true"`) || !strings.Contains(out, `class="size-5"`) || !strings.Contains(out, "<path") {
		t.Fatal(out)
	}
	defer func() {
		if recover() == nil {
			t.Fatal("unknown icon accepted")
		}
	}()
	Icon("nope", "")
}

func TestFormatting(t *testing.T) {
	Now = func() time.Time { return time.Unix(10_000, 0) }
	defer func() { Now = time.Now }()
	cases := map[string]string{
		Ago(0): "never", Ago(9_990): "just now", Ago(10_000 - 600): "10 min ago", Ago(10_000 - 7200): "2 h ago",
		Millis(250): "250 ms", Millis(1500): "1.5 s", Millis(125_000): "2m 05s",
		Bytes(512): "512 B", Bytes(1536): "1.5 KiB", Bytes(5 << 30): "5.0 GiB",
		Usage(1<<30, 4<<30): "1.0 GiB / 4.0 GiB (25%)", Usage(1, 0): "—",
		Permille(5, 10): "500", Permille(20, 10): "1000",
		ShortSHA("0123456789abcdef"): "0123456", CPUs(1_500_000_000): "1.5", MiB(256 << 20): "256",
		Span(9_000, 9_008): "8.0 s", Span(0, 1): "—",
	}
	for got, want := range cases {
		if got != want {
			t.Fatalf("got %q want %q", got, want)
		}
	}
}

func TestToastAndDisclosure(t *testing.T) {
	out := markup(t, Toast("info", "Publishing api at a1b2c3d."))
	for _, want := range []string{`data-tone="info"`, `role="status"`, `data-toast-dismiss`, `aria-label="Dismiss notification"`, "Publishing api at a1b2c3d."} {
		if !strings.Contains(out, want) {
			t.Fatalf("toast lacks %s: %s", want, out)
		}
	}
	if strings.Contains(out, "setTimeout") {
		t.Fatalf("toast schedules its own removal: %s", out)
	}
	out = markup(t, Disclosure("adv", "Advanced", true, "", nil))
	for _, want := range []string{`id="adv"`, `class="disclosure"`, " open", "disclosure-chevron", "Advanced"} {
		if !strings.Contains(out, want) {
			t.Fatalf("disclosure lacks %s: %s", want, out)
		}
	}
}

func TestPhraseEscapesTextAndParts(t *testing.T) {
	var b strings.Builder
	if err := Phrase("Version %s <didn't> go live.", Mono("<a1b2>")).Render(context.Background(), &b); err != nil {
		t.Fatal(err)
	}
	if got, want := b.String(), `Version <span class="mono">&lt;a1b2&gt;</span> &lt;didn&#39;t&gt; go live.`; got != want {
		t.Fatalf("%s, want %s", got, want)
	}
}

func TestBrands(t *testing.T) {
	for slug, b := range Brands() {
		if b.Title == "" || len(b.Hex) != 6 || b.path == "" {
			t.Errorf("%s: incomplete brand %+v", slug, b)
		}
	}
	// Near-black marks follow the text color so they show on the dark theme.
	if Brands()["github"].fill != "currentColor" || Brands()["docker"].fill != "#2496ED" {
		t.Fatal(Brands()["github"].fill, Brands()["docker"].fill)
	}
	var b strings.Builder
	if err := Brand("docker", "size-5", false).Render(context.Background(), &b); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`role="img"`, `aria-label="Docker"`, `fill="#2496ED"`, `class="size-5"`, `<path d="M13.983`} {
		if !strings.Contains(b.String(), want) {
			t.Errorf("missing %s in %s", want, b.String())
		}
	}
	defer func() {
		if recover() == nil {
			t.Error("unknown brand did not panic")
		}
	}()
	Brand("nope", "", true)
}
