# go-resolver fixture

Project for `src/language/go-resolver.ts`, asserted in
`tests/integration/go-resolver.test.ts`.

- `go.work` uses `api` and `lib`, and replaces `example.com/shared` with `./shared`.
- `api/go.mod` replaces `github.com/acme/kit` with `../kit` (a local directory
  inside the project), `golang.org/x/text` with a newer version, and
  `example.com/outside` with a directory outside the project.
- `api/vendor/modules.txt` vendors `github.com/vendored/thing`. No vendored
  sources: the inventory skips `vendor/`.
- `api/cmd/server/main.go` imports `example.com/ws/api/internal/missing`,
  which has no files.
- `tools` is a module the workspace does not use; `plain` declares a module
  path without a dot.
