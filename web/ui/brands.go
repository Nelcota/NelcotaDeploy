package ui

import (
	"context"
	"embed"
	"encoding/base64"
	"encoding/json"
	"html"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"

	"github.com/a-h/templ"
)

// Brand marks come from Simple Icons (brands/LICENSE.md, brands/DISCLAIMER.md);
// scripts/web-vendor.sh copies them with their official colors. The marks
// remain their owners' trademarks and only name the product next to it.
//
//go:embed brands/*.svg brands/brands.json brands/color/*.svg
var brandFiles embed.FS

// BrandInfo is a vendored brand mark.
type BrandInfo struct {
	Title string `json:"title"`
	Hex   string `json:"hex"`
	// Guidelines links to the owner's brand rules, when Simple Icons lists them.
	Guidelines string `json:"guidelines"`
	path       string
	// fill is the official color, or currentColor for near-black marks that
	// would disappear on the dark theme.
	fill string
	// color is a data URI of the full-color logo (brands/color, from
	// Devicon), when there is one; it replaces the one-color mark.
	color string
}

var brandPath = regexp.MustCompile(`<path d="([^"]+)"`)

var brands = func() map[string]BrandInfo {
	raw, err := brandFiles.ReadFile("brands/brands.json")
	if err != nil {
		panic(err)
	}
	m := map[string]BrandInfo{}
	if err := json.Unmarshal(raw, &m); err != nil {
		panic(err)
	}
	for slug, b := range m {
		svg, err := brandFiles.ReadFile("brands/" + slug + ".svg")
		if err != nil {
			panic(err)
		}
		p := brandPath.FindSubmatch(svg)
		if p == nil {
			panic("ui: brand " + slug + " has no path")
		}
		b.path = string(p[1])
		b.fill = "#" + b.Hex
		if luminance(b.Hex) < 0.05 {
			b.fill = "currentColor"
		}
		// An <img> keeps each logo's gradient IDs from clashing when the same
		// logo appears more than once on a page.
		if logo, err := brandFiles.ReadFile("brands/color/" + slug + ".svg"); err == nil {
			b.color = "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString(logo)
		}
		m[slug] = b
	}
	return m
}()

// luminance is the WCAG relative luminance of a six-digit hex color.
func luminance(hex string) float64 {
	n, err := strconv.ParseUint(hex, 16, 32)
	if err != nil || len(hex) != 6 {
		return 0
	}
	l := 0.0
	for i, w := range []float64{0.2126, 0.7152, 0.0722} {
		c := float64((n>>(16-8*i))&0xff) / 255
		if c <= 0.03928 {
			c /= 12.92
		} else {
			c = math.Pow((c+0.055)/1.055, 2.4)
		}
		l += w * c
	}
	return l
}

// Brand renders an official brand mark in its color. The mark carries its
// title for screen readers unless decorative is set (when a visible label
// already names it). Unknown slugs panic so tests catch typos.
func Brand(slug, class string, decorative bool) templ.Component {
	b, ok := brands[slug]
	if !ok {
		panic("ui: unknown brand " + slug)
	}
	if class == "" {
		class = "size-4"
	}
	if b.color != "" {
		alt := `alt="` + html.EscapeString(b.Title) + `"`
		if decorative {
			alt = `alt="" aria-hidden="true"`
		}
		return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
			_, err := io.WriteString(w, `<img src="`+b.color+`" `+alt+` class="`+html.EscapeString(class)+` object-contain" draggable="false">`)
			return err
		})
	}
	a11y := `role="img" aria-label="` + html.EscapeString(b.Title) + `"`
	if decorative {
		a11y = `aria-hidden="true"`
	}
	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		_, err := io.WriteString(w, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="`+b.fill+`" `+a11y+` focusable="false" class="`+html.EscapeString(class)+`"><path d="`+b.path+`"/></svg>`)
		return err
	})
}

// BrandTitle is the product name a brand mark stands for.
func BrandTitle(slug string) string {
	if b, ok := brands[slug]; ok {
		return b.Title
	}
	return strings.ToUpper(slug[:1]) + slug[1:]
}

// Brands lists the vendored brand slugs, for tests.
func Brands() map[string]BrandInfo { return brands }
