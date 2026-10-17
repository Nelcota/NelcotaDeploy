package ui

import (
	"context"
	"io"
	"strings"

	"github.com/Nelcota/NelcotaDeploy/web/i18n"
	"github.com/a-h/templ"
)

// Phrase renders a whole translated sentence whose %s placeholders are
// components, such as a commit SHA in monospace, so translators see the full
// sentence instead of fragments. The sentence text is escaped, and each part
// renders through templ, so nothing is spliced in raw.
func Phrase(format string, parts ...templ.Component) templ.Component {
	return templ.ComponentFunc(func(ctx context.Context, w io.Writer) error {
		text := i18n.T(ctx, format)
		for _, part := range parts {
			before, after, ok := strings.Cut(text, "%s")
			if !ok {
				break
			}
			if _, err := io.WriteString(w, templ.EscapeString(before)); err != nil {
				return err
			}
			if err := part.Render(ctx, w); err != nil {
				return err
			}
			text = after
		}
		_, err := io.WriteString(w, templ.EscapeString(text))
		return err
	})
}

// Mono renders s in the monospace style used for commits, ports, and paths.
func Mono(s string) templ.Component {
	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		_, err := io.WriteString(w, `<span class="mono">`+templ.EscapeString(s)+`</span>`)
		return err
	})
}

// Text renders s as escaped text, for values placed into a Phrase.
func Text(s string) templ.Component {
	return templ.ComponentFunc(func(_ context.Context, w io.Writer) error {
		_, err := io.WriteString(w, templ.EscapeString(s))
		return err
	})
}
