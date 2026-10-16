// Package i18n translates interface strings. English source strings are the
// keys; a locale's catalog maps them to translations. Missing entries fall back
// to English, so untranslated text is never blank.
package i18n

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
)

// Locale identifies a supported interface language.
type Locale string

const (
	English    Locale = "en"
	Portuguese Locale = "pt-BR"
)

// Locales lists the supported languages in menu order.
var Locales = []Locale{English, Portuguese}

// Name is a language's own name, shown in the language menu.
func Name(l Locale) string {
	if l == Portuguese {
		return portugueseName
	}
	return "English"
}

// Param is the query parameter that switches the language.
const Param = "lang"

// SwitchURL returns path with the language parameter set.
func SwitchURL(path string, l Locale) string {
	u, err := url.Parse(path)
	if err != nil || path == "" || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		u = &url.URL{Path: "/"}
	}
	q := u.Query()
	q.Set(Param, string(l))
	u.RawQuery = q.Encode()
	u.Fragment = ""
	return u.RequestURI()
}

// Cookie stores the viewer's language choice. It is a preference, not a secret.
const Cookie = "nelcota_lang"

var catalogs = map[Locale]map[string]string{Portuguese: ptBR}

type key struct{}

// WithLocale returns a context that renders in locale l.
func WithLocale(ctx context.Context, l Locale) context.Context {
	return context.WithValue(ctx, key{}, l)
}

// From returns the context's locale, English by default.
func From(ctx context.Context) Locale {
	if l, ok := ctx.Value(key{}).(Locale); ok {
		return l
	}
	return English
}

// Parse accepts a stored or requested language tag.
func Parse(tag string) (Locale, bool) {
	t := strings.ToLower(strings.TrimSpace(tag))
	switch {
	case t == "en" || strings.HasPrefix(t, "en-"):
		return English, true
	case t == "pt" || strings.HasPrefix(t, "pt-"):
		return Portuguese, true
	}
	return English, false
}

// Detect picks the cookie's language, then the first supported language in
// Accept-Language, then English.
func Detect(r *http.Request) Locale {
	if c, err := r.Cookie(Cookie); err == nil {
		if l, ok := Parse(c.Value); ok {
			return l
		}
	}
	for part := range strings.SplitSeq(r.Header.Get("Accept-Language"), ",") {
		tag, _, _ := strings.Cut(part, ";")
		if l, ok := Parse(tag); ok {
			return l
		}
	}
	return English
}

var number = regexp.MustCompile(`\d+`)

// T translates s for the context's locale. Text with one number, such as
// "5 min ago", is found under its pattern ("%d min ago") when it has no entry
// of its own.
func T(ctx context.Context, s string) string {
	c := catalogs[From(ctx)]
	if c == nil || s == "" {
		return s
	}
	if t, ok := c[s]; ok {
		return t
	}
	if loc := number.FindAllStringIndex(s, 2); len(loc) == 1 {
		n := s[loc[0][0]:loc[0][1]]
		if t, ok := c[s[:loc[0][0]]+"%d"+s[loc[0][1]:]]; ok {
			return strings.Replace(t, "%d", n, 1)
		}
	}
	return s
}

// TC translates s in a context, for English words with several meanings: the
// catalog key is context + "|" + s. Without that entry it falls back to T.
func TC(ctx context.Context, context, s string) string {
	if t := T(ctx, context+"|"+s); t != context+"|"+s {
		return t
	}
	return T(ctx, s)
}

// Tf translates a format string, then fills it like fmt.Sprintf.
func Tf(ctx context.Context, format string, args ...any) string {
	return fmt.Sprintf(T(ctx, format), args...)
}

// Catalog returns a copy of a locale's translations, keyed by English text.
func Catalog(l Locale) map[string]string {
	out := make(map[string]string, len(catalogs[l]))
	for k, v := range catalogs[l] {
		out[k] = v
	}
	return out
}

// Strings returns translations for keys, for scripts that render text in the browser.
func Strings(ctx context.Context, keys []string) map[string]string {
	out := make(map[string]string, len(keys))
	for _, k := range keys {
		if t := T(ctx, k); t != k {
			out[k] = t
		}
	}
	return out
}
