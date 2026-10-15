package web

import (
	"github.com/go-chi/chi/v5"
	"github.com/nelcota/nelcota-deploy/internal/service"
	"net/http"
)

// Register is the frontend extension point. Services enforce authorization independently of HTTP.
func Register(r chi.Router, _ service.Services) {
	r.Get("/", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte("<!doctype html><html lang=pt-BR><meta charset=utf-8><title>Nelcota Deploy</title><h1>Nelcota Deploy</h1><p>Backend disponível. Frontend reservado para a próxima etapa.</p></html>"))
	})
}
