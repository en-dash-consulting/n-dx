# Go Fixture — Import Syntax Variant Coverage Map

Fixture project for `go-imports.ts` parser testing. Each file below
demonstrates one or more import syntax variants the parser must handle.

## Variant definitions

| Variant | Syntax | Regex in parser |
|---------|--------|-----------------|
| **single** | `import "pkg"` | `SINGLE_IMPORT_RE` |
| **grouped** | `import ( ... )` | `IMPORT_BLOCK_START_RE` + `IMPORT_LINE_RE` |
| **aliased** | `alias "pkg"` (single or grouped) | capture group `(\w+\|_\|\.)\s+` |
| **blank** | `_ "pkg"` (side-effect import) | alias = `"_"` |
| **dot** | `. "pkg"` (namespace merge) | alias = `"."` |
| **test file** | `*_test.go` imports | same parser; tests coverage of `_test.go` inclusion |

## File → variant mapping

| File | Variants | Classification | Notes |
|------|----------|----------------|-------|
| `cmd/api/main.go` | grouped | stdlib (`fmt`, `net/http`), internal (`handler`, `config`) | Mixed stdlib + internal in one block |
| `cmd/api/router.go` | single | third-party (`chi/v5`) | Bare single-line third-party |
| `cmd/api/setup.go` | grouped, **aliased** | stdlib (`net/http`), third-party (`chimw "chi/v5/middleware"`) | Aliased third-party inside grouped block |
| `internal/config/config.go` | single | stdlib (`os`) | Single-segment stdlib path |
| `internal/handler/user.go` | grouped | stdlib (`encoding/json`, `net/http`), internal (`service`) | Multi-segment stdlib + internal |
| `internal/handler/user_test.go` | grouped, **test file** | stdlib (`net/http`, `net/http/httptest`, `testing`) | Test-only stdlib grouped block |
| `internal/middleware/auth.go` | single | stdlib (`net/http`) | Multi-segment stdlib single-line |
| `internal/middleware/logging.go` | grouped | stdlib (`log`, `net/http`, `time`) | Three stdlib in one block |
| `internal/repository/user.go` | *(none)* | *(no imports)* | Exercises empty-import edge case |
| `internal/repository/user_test.go` | single, **test file** | stdlib (`testing`) | Minimal test file |
| `internal/repository/db.go` | single | third-party (`sqlx`) | Bare single-line third-party |
| `internal/repository/drivers.go` | grouped, **blank** | stdlib (`database/sql`), third-party (`_ "lib/pq"`) | Blank import for driver registration |
| `internal/service/user.go` | grouped | internal (`repository`) | Sole internal import in grouped block |
| `internal/service/user_test.go` | single, **test file** | stdlib (`testing`) | Minimal test file |
| `pkg/response/json.go` | grouped | stdlib (`encoding/json`, `net/http`) | Stdlib-only grouped block |
| `pkg/response/json_test.go` | grouped, **dot**, **test file** | stdlib (`net/http`, `net/http/httptest`, `strings`, `testing`), internal dot (`. "pkg/response"`) | External test package with dot import |

## Variant coverage summary

| Variant | Covered? | Primary fixture file(s) |
|---------|----------|------------------------|
| single | Yes | `router.go`, `config.go`, `auth.go`, `db.go` |
| grouped | Yes | `main.go`, `handler/user.go`, `logging.go`, `response/json.go` |
| aliased | Yes | `setup.go` (`chimw "github.com/go-chi/chi/v5/middleware"`) |
| blank | Yes | `drivers.go` (`_ "github.com/lib/pq"`) |
| dot | Yes | `json_test.go` (`. "github.com/example/go-project/pkg/response"`) |
| test file | Yes | `handler/user_test.go`, `repository/user_test.go`, `service/user_test.go`, `json_test.go` |

## Classification coverage

The parser classifies every import into one of three categories based on
`go.mod` module path (`github.com/example/go-project`):

| Classification | Rule | Fixture files |
|---------------|------|---------------|
| stdlib | No dot in first path segment | `config.go` (`os`), `auth.go` (`net/http`), `logging.go` (`log`, `time`), etc. |
| third-party | Dot in first segment, no module-path prefix | `router.go` (`chi/v5`), `db.go` (`sqlx`), `drivers.go` (`lib/pq`), `setup.go` (`chi/v5/middleware`) |
| internal | Starts with module path | `main.go` (`handler`, `config`), `handler/user.go` (`service`), `service/user.go` (`repository`), `json_test.go` (`pkg/response`) |

## Intentionally absent variants

These variants are supported by `go-imports.ts` but deliberately omitted from
the fixture because they are covered by unit tests with inline source strings
in `go-imports.test.ts`:

| Variant | Rationale |
|---------|-----------|
| Single-line aliased (`import alias "pkg"`) | Real Go code almost exclusively uses aliases inside grouped blocks. Unit test line 41–47 covers this form. The fixture demonstrates aliased inside a grouped block (`setup.go`), which exercises the same regex capture group. |
| Single-line blank (`import _ "pkg"`) | Blank imports in practice always appear in grouped blocks alongside the package they enable. Unit test line 49–56 covers this. |
| Single-line dot (`import . "pkg"`) | Dot imports are rare and nearly always appear in `_test.go` grouped blocks. Unit test line 58–64 covers the single-line form. |
| Multiple import blocks in one file | Legal Go but rejected by `goimports`/`gofmt` tooling, so never seen in real projects. Unit test line 598–613 covers this. |
| Block comments inside import blocks | Parser concern, not a structural variant. Tested with synthetic source in unit test lines 426–459. |
| Import-like strings in function bodies | Edge case for comment/string-literal stripping. Unit test lines 478–517 cover this. |
