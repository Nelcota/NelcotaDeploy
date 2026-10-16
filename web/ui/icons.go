package ui

import (
	"context"
	"embed"
	"html"
	"io"
	"path"
	"strings"

	"github.com/a-h/templ"
)

//go:embed icons/*.svg
var iconFiles embed.FS

// icons maps Lucide names to the inner markup of their SVG, loaded once.
var icons = func() map[string]string {
	entries, err := iconFiles.ReadDir("icons")
	if err != nil {
		panic(err)
	}
	m := make(map[string]string, len(entries))
	for _, entry := range entries {
		b, err := iconFiles.ReadFile("icons/" + entry.Name())
		if err != nil {
			panic(err)
		}
		s := string(b)
		open := strings.Index(s, "<svg")
		start := open + strings.Index(s[open:], ">") + 1
		end := strings.LastIndex(s, "</svg>")
		inner := strings.Join(strings.Fields(s[start:end]), " ")
		m[strings.TrimSuffix(entry.Name(), path.Ext(entry.Name()))] = inner
	}
	return m
}()

// Icon renders a decorative Lucide icon, or a brand mark vendored next to them
// (github). Unknown names panic so tests catch typos.
func Icon(name, class string) templ.Component {
	inner, ok := icons[name]
	if !ok {
		panic("ui: unknown icon " + name)
	}
	if class == "" {
		class = "size-4"
	}
	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		_, err := io.WriteString(w, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" class="`+html.EscapeString(class)+`">`+inner+`</svg>`)
		return err
	})
}
