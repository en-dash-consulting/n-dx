module example.com/ws/api

go 1.22

require (
	example.com/ws/lib v0.0.0
	github.com/acme/kit v1.2.0
	github.com/go-chi/chi/v5 v5.0.10
	github.com/vendored/thing v0.3.1
	golang.org/x/text v0.14.0 // indirect
)

replace github.com/acme/kit => ../kit

replace golang.org/x/text => golang.org/x/text v0.15.0

replace example.com/outside => ../../outside
