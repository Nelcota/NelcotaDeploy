package static

import (
	"strings"
	"testing"
)

// TestAssetBudget enforces the performance budget on compressed (Brotli) sizes:
// all JavaScript together under 105 KB and all CSS under 50 KB. The limit was
// 100 KB until the image editor (editor.js), which loads only on demand.
func TestAssetBudget(t *testing.T) {
	var js, css int
	for _, name := range Names() {
		if strings.HasSuffix(name, ".woff2") || strings.HasSuffix(name, ".png") {
			t.Logf("%-14s %7d B (already compressed)", name, Size(name, ""))
			continue
		}
		size := Size(name, ".br")
		if size == 0 {
			t.Fatal("missing Brotli variant", name)
		}
		if Size(name, ".zst") == 0 {
			t.Fatal("missing zstd variant", name)
		}
		switch {
		case strings.HasSuffix(name, ".js"):
			js += size
		case strings.HasSuffix(name, ".css"):
			css += size
		}
		t.Logf("%-14s %7d B raw %6d B br %6d B zstd", name, Size(name, ""), size, Size(name, ".zst"))
	}
	t.Logf("total JavaScript %d B, CSS %d B (Brotli)", js, css)
	if js >= 105_000 {
		t.Fatalf("JavaScript budget exceeded: %d B", js)
	}
	if css >= 50_000 {
		t.Fatalf("CSS budget exceeded: %d B", css)
	}
}

func TestAccepts(t *testing.T) {
	for _, row := range []struct {
		header, token string
		want          bool
	}{{"br", "br", true}, {"gzip, br;q=0.5", "br", true}, {"br;q=0", "br", false}, {"gzip", "br", false}, {"BR", "br", true}, {"zstd;q=0.0", "zstd", false}} {
		if got := accepts(row.header, row.token); got != row.want {
			t.Fatal(row, got)
		}
	}
}

func TestPathPanicsOnUnknownAsset(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Fatal("expected panic")
		}
	}()
	Path("missing.js")
}
