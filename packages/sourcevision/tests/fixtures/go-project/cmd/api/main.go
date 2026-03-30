package main

import (
	"fmt"
	"net/http"

	"github.com/example/go-project/internal/handler"
	"github.com/example/go-project/internal/config"
)

func main() {
	cfg := config.Load()
	h := handler.NewUserHandler()

	http.HandleFunc("/users", h.List)
	fmt.Printf("Listening on :%d\n", cfg.Port)
	http.ListenAndServe(fmt.Sprintf(":%d", cfg.Port), nil)
}
