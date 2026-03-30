package main

import (
	"net/http"

	chimw "github.com/go-chi/chi/v5/middleware"
)

// SetupMiddleware configures standard middleware on the given handler.
func SetupMiddleware(h http.Handler) http.Handler {
	stack := chimw.Recoverer
	return stack(h)
}
