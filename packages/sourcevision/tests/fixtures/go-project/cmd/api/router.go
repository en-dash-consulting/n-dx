package main

import "github.com/go-chi/chi/v5"

// NewRouter creates a new chi router with default middleware.
func NewRouter() *chi.Mux {
	r := chi.NewRouter()
	return r
}
