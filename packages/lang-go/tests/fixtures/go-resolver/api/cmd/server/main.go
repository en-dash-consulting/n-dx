package main

import (
	"fmt"

	"example.com/outside/pkg"
	"example.com/shared"
	"example.com/ws/api"
	"example.com/ws/api/internal/missing"
	store "example.com/ws/api/internal/store"
	"example.com/ws/lib/greet"
	"github.com/acme/kit/log"
	mw "github.com/go-chi/chi/v5/middleware"
	"github.com/unknown/dep"
	"github.com/vendored/thing/sub"
	_ "golang.org/x/text/language"
)

func main() {
	fmt.Println(api.Version, store.Open(), greet.Hello(), shared.Name, mw.Logger, pkg.X, missing.Y, dep.Z, sub.W)
	log.Print()
}
