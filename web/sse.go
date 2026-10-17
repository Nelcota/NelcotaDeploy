package web

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/Nelcota/NelcotaDeploy/web/ui"
	"github.com/a-h/templ"
)

// stream writes Datastar server-sent events. It is used both for one-shot action
// responses and for long-lived live-update streams.
type stream struct {
	w   http.ResponseWriter
	rc  *http.ResponseController
	ctx context.Context
	buf bytes.Buffer
}

func newStream(w http.ResponseWriter, r *http.Request) *stream {
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-store")
	h.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)
	return &stream{w: w, rc: http.NewResponseController(w), ctx: r.Context()}
}

func (s *stream) send(event string, lines []string) error {
	_ = s.rc.SetWriteDeadline(time.Now().Add(5 * time.Second))
	var b strings.Builder
	b.WriteString("event: ")
	b.WriteString(event)
	b.WriteByte('\n')
	for _, line := range lines {
		b.WriteString("data: ")
		b.WriteString(line)
		b.WriteByte('\n')
	}
	b.WriteByte('\n')
	if _, err := fmt.Fprint(s.w, b.String()); err != nil {
		return err
	}
	return s.rc.Flush()
}

type patchMode string

const (
	modeOuter patchMode = "outer"
	// modeReplace swaps the element without morphing, which also reaches
	// elements inside data-ignore-morph.
	modeReplace patchMode = "replace"
	modeInner   patchMode = "inner"
	modeAppend  patchMode = "append"
	modePrepend patchMode = "prepend"
	modeRemove  patchMode = "remove"
)

// patch morphs rendered elements into the page. Without a selector, top-level
// elements are matched by id.
func (s *stream) patch(c templ.Component, selector string, mode patchMode) error {
	s.buf.Reset()
	if c != nil {
		if err := c.Render(s.ctx, &s.buf); err != nil {
			return err
		}
	}
	var lines []string
	if selector != "" {
		lines = append(lines, "selector "+selector)
	}
	if mode != "" && mode != modeOuter {
		lines = append(lines, "mode "+string(mode))
	}
	for line := range strings.SplitSeq(s.buf.String(), "\n") {
		if strings.TrimSpace(line) != "" {
			lines = append(lines, "elements "+line)
		}
	}
	return s.send("datastar-patch-elements", lines)
}

// signals merges values into the page's signals.
func (s *stream) signals(v map[string]any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return s.send("datastar-patch-signals", []string{"signals " + string(b)})
}

// toast appends a notification. Danger toasts are announced assertively.
func (s *stream) toast(tone, message string) error {
	return s.patch(ui.Toast(tone, message), "#toaster", modeAppend)
}

// redirect navigates the browser. Datastar re-creates the script with the page nonce.
func (s *stream) redirect(url string) error {
	return s.patch(ui.Redirect(url), "body", modeAppend)
}

// run executes a client-side expression once (reset a form, close a dialog).
func (s *stream) run(expr string) error {
	return s.patch(ui.Run(expr), "body", modeAppend)
}

// closeAndReset closes open dialogs and resets forms in, or equal to, the
// elements matching selector.
func (s *stream) closeAndReset(selector string) error {
	return s.run("document.querySelectorAll(" + ui.JS(selector) + ").forEach(r => { [r, ...r.querySelectorAll('dialog')].forEach(d => d.open && d.close()); [...(r.tagName === 'FORM' ? [r] : []), ...r.querySelectorAll('form')].forEach(f => f.reset()) })")
}

// comment keeps an idle stream alive through proxies.
func (s *stream) comment() error {
	_ = s.rc.SetWriteDeadline(time.Now().Add(5 * time.Second))
	if _, err := fmt.Fprint(s.w, ": keepalive\n\n"); err != nil {
		return err
	}
	return s.rc.Flush()
}
