package web

import (
	"github.com/Nelcota/NelcotaDeploy/internal/service"
	"github.com/go-chi/chi/v5"
	"net/http"
)

// Register is the frontend extension point. Services enforce authorization independently of HTTP.
func Register(r chi.Router, _ service.Services) {
	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<!doctype html><html lang=en><meta charset=utf-8><title>NelcotaDeploy</title><h1>NelcotaDeploy</h1><p>Backend available. The frontend is planned for the next stage.</p></html>"))
	})
}
