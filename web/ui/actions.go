package ui

import (
	"encoding/json"
	"strings"
)

// Datastar expression helpers. Expressions are evaluated by the browser, so
// dynamic values are always embedded as JSON string literals, never spliced raw.

// JS returns s as a JavaScript string literal safe to embed in an expression.
func JS(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}

func action(method, url string, form bool) string {
	var b strings.Builder
	b.WriteString("@")
	b.WriteString(method)
	b.WriteString("(")
	b.WriteString(JS(url))
	b.WriteString(",{headers:{'X-CSRF-Token':$_csrf}")
	if form {
		b.WriteString(",contentType:'form'")
	}
	b.WriteString("})")
	return b.String()
}

// Post sends a CSRF-protected POST with no form body.
func Post(url string) string { return action("post", url, false) }

// PostForm submits the closest form as application/x-www-form-urlencoded.
func PostForm(url string) string { return action("post", url, true) }

// Get fetches a fragment.
func Get(url string) string { return "@get(" + JS(url) + ")" }

// Stream opens a long-lived Datastar stream that reconnects with backoff.
// Datastar pauses it while the tab is hidden and reconnects when visible again;
// the server sends a fresh snapshot on every connection.
func Stream(url string) string {
	return "@get(" + JS(url) + ",{retry:'always',retryInterval:1000,retryScaler:2,retryMaxWait:30000,retryMaxCount:1000})"
}

// Signals encodes initial page signals as a JavaScript object literal.
func Signals(v map[string]any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

// Open returns an expression that opens the dialog with the given id.
func Open(id string) string { return "document.getElementById(" + JS(id) + ").showModal()" }

// PostFormOf submits the form matching selector, for buttons outside the form
// such as a confirmation dialog.
func PostFormOf(url, selector string) string {
	return "@post(" + JS(url) + ",{headers:{'X-CSRF-Token':$_csrf},contentType:'form',selector:" + JS(selector) + "})"
}
