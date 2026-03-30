package main

import (
	"fmt"
	"net/http"

	"github.com/example/mixed-project/internal/api"
)

func main() {
	handler := api.NewRouter()
	fmt.Println("Starting server on :8080")
	http.ListenAndServe(":8080", handler)
}
