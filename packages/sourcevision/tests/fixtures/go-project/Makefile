.PHONY: build test lint

build:
	go build -o bin/api ./cmd/api

test:
	go test ./...

lint:
	golangci-lint run
