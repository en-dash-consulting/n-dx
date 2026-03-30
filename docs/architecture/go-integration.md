# Go Language Integration

> Architecture and implementation details for Go support in n-dx.

---

## Overview

Go is the first non-JavaScript/TypeScript language supported by n-dx. The integration spans all three core packages (SourceVision, Rex, Hench) and enables the full `ndx init → analyze → plan → work` workflow on Go codebases.

The implementation follows a key design principle: **Go support extends existing systems through configuration and dispatch, not duplication.** The zone detection algorithm, PRD management, and agent execution loop are unchanged. Language-specific behavior is isolated to parsers, classifiers, and guard templates.

---

## File Inventory

Go files are classified using the language registry (`packages/sourcevision/src/language/go.ts`).

### File Role Classification

| Pattern | Role | Example |
|---------|------|---------|
| `*.go` (not test/generated) | `source` | `internal/handler/user.go` |
| `*_test.go` | `test` | `internal/handler/user_test.go` |
| `*_gen.go`, `*.pb.go`, `wire_gen.go`, `mock_*.go` | `generated` | `proto/api.pb.go` |
| `go.mod`, `go.sum`, `.golangci.yml`, `Makefile` | `config` | `go.mod` |
| `testdata/` contents | `asset` | `testdata/users.json` |

### Skip Directories

Go projects skip `vendor/` (equivalent to `node_modules/`). Standard Go directories like `internal/`, `cmd/`, and `pkg/` are **not** skipped — they contain source code.

---

## Import Graph

**File:** `packages/sourcevision/src/analyzers/go-imports.ts`

### Parser Design

The Go import parser is regex-based (no Go toolchain dependency). It handles all import syntax variants:

| Variant | Syntax | Example |
|---------|--------|---------|
| Single | `import "pkg"` | `import "fmt"` |
| Grouped | `import ( ... )` | `import ( "fmt"; "net/http" )` |
| Aliased | `import alias "pkg"` | `import chi "github.com/go-chi/chi/v5"` |
| Blank | `import _ "pkg"` | `import _ "github.com/lib/pq"` |
| Dot | `import . "pkg"` | `import . "testing"` |

The parser strips comments (`//` and `/* */`) before extraction and ignores import-like text inside string literals.

### Import Classification

Every import is classified into one of three categories using the module path from `go.mod`:

| Category | Rule | Edge Type | Example |
|----------|------|-----------|---------|
| **Internal** | Starts with module path | `ImportEdge` (file → directory) | `github.com/myapp/internal/handler` → edge to `internal/handler` |
| **Stdlib** | No dot in first path segment | `ExternalImport` with `stdlib:` prefix | `fmt` → `stdlib:fmt` |
| **Third-party** | Has dot, doesn't start with module path | `ExternalImport` | `github.com/go-chi/chi/v5` |

### File-to-Package Edge Semantics

This is the most important architectural difference from JS/TS:

```
JS/TS:  src/handler/user.ts  →  src/service/user-service.ts     (file → file)
Go:     handler/user.go      →  internal/service                  (file → directory)
```

Go imports target packages (directories), not files. A single `import "module/internal/service"` imports all exported symbols from all `.go` files in that directory. The edge target in `imports.json` is a relative directory path.

**Consequences:**
- Zone detection operates at package granularity for Go (vs file granularity for JS/TS)
- Files within the same Go package always cluster together in one zone
- All imports carry `ImportType: "static"` (Go has no dynamic imports)
- Symbols are recorded as `["*"]` (Go imports entire packages)

### Module Path Resolution

The `go.mod` file is read **once** at the start of analysis to extract the module path. For each import:

1. Check if the import path starts with the module path
2. If yes → strip the module path prefix to get the relative directory
3. If no → classify as stdlib or third-party

Example with `module github.com/example/myapp`:

```
Import: "github.com/example/myapp/internal/handler"
Strip:  "github.com/example/myapp/"
Result: edge to "internal/handler"
```

---

## Zone Detection

Go projects feed into the same Louvain community detection algorithm as JS/TS. The algorithm is language-agnostic — it operates on graph nodes (files) and edges (imports).

### Edge Resolution

Go import edges target directories, but zone file maps contain individual file paths. The `resolveEdgeTarget()` function bridges this gap by expanding directory targets to all files in that directory:

```
Edge: handler/user.go → internal/service
Resolves to: handler/user.go → [internal/service/user.go, internal/service/order.go]
```

This enables accurate zone crossing computation and coupling/cohesion metrics.

### Zone Naming

Go's package structure maps naturally to zone names. The zone naming algorithm skips generic segments (`internal`, `pkg`, `src`, `lib`):

| File Path | Zone Name | Reasoning |
|-----------|-----------|-----------|
| `internal/handler/user.go` | Handler | `internal` skipped → `handler` |
| `internal/service/user.go` | Service | `internal` skipped → `service` |
| `pkg/response/json.go` | Response | `pkg` skipped → `response` |
| `cmd/api/main.go` | API | `cmd` preserved → clustering decides |

### Real-World Validation

Tested against PocketBase (843 files):

| Metric | Value |
|--------|-------|
| Import edges | 756 |
| External packages | 125 |
| Zones | 26 |
| Zone crossings | 49 |
| Hub detection | `core` imported by 5 zones |
| Bidirectional coupling | `infrastructure-tools` ↔ `s3-blob-driver` flagged |

---

## Route Detection

**File:** `packages/sourcevision/src/analyzers/go-route-detection.ts`

Regex-based detection of HTTP route registrations across 6 Go frameworks:

| Framework | Pattern | Example |
|-----------|---------|---------|
| net/http | `http.HandleFunc("/path", handler)` | Stdlib |
| chi | `r.Get("/path", handler)` | Lowercase methods |
| gin | `r.GET("/path", handler)` | Uppercase methods |
| echo | `e.GET("/path", handler)` | Uppercase methods |
| fiber | `app.Get("/path", handler)` | Mixed case |
| gorilla/mux | `r.HandleFunc("/path").Methods("GET")` | Method chaining |

The detector strips Go comments before matching, preserves path parameters as-is (`{id}`, `:id`), and groups routes by common prefix. Output uses the existing `ServerRoute` and `ServerRouteGroup` types — no schema changes required.

---

## Archetype Classification

Go-specific archetype signals are scoped using the `languages: ["go"]` field:

| Archetype | Go Signals |
|-----------|-----------|
| `entrypoint` | `main.go` (0.9), `/cmd/` directory (0.7) |
| `types` | `types.go` (0.9), `models.go` (0.8), `entities.go` (0.8) |
| `route-handler` | `handler.go` (0.8), `/handler/` (0.8), `/handlers/` (0.8) |
| `test-helper` | `/testdata/` (0.9), `/testutil/` (0.8) |

Frontend-specific archetypes (`component`, `hook`, `page`, `route-module`) are scoped to `["typescript", "javascript"]` and do not fire in Go projects.

---

## Rex Scanner Support

**File:** `packages/rex/src/analyze/scanners.ts`

### go.mod Parsing

`parseGoMod()` extracts structured data from `go.mod`:

- Module path
- Go version requirement
- Dependencies (from `require` block)
- Replace directives

`scanGoMod()` produces Rex proposals from this data (e.g., dependency update tasks, Go version upgrade tasks).

### Go-Aware Scanning

- `vendor/` added to skip directories
- `go.mod` and `go.sum` added to skip config files (not scanned for doc content)
- `_test.go` recognized by `isTestFile()`

---

## Hench Agent Support

### Guard Configuration

```typescript
const GO_GUARD_DEFAULTS = {
  blockedPaths: [".hench/**", ".rex/**", ".git/**", "vendor/**"],
  allowedCommands: ["go", "make", "git", "golangci-lint"],
  commandTimeout: 30000,
  maxFileSize: 1048576,
};
```

Selected via `guardDefaultsForLanguage("go")` when the manifest language is Go.

### Test Runner

Go test detection and execution:

- **Pattern:** `/_test\.go$/`
- **Runner:** `go test ./...` (all packages) or `go test ./internal/handler/...` (scoped)
- **Specific test:** `go test -run TestName ./pkg/...`

### Language Context

`buildGoLanguageContext()` provides Go-specific guidance to the agent brief:

- Go testing conventions (`go test`, table-driven tests, `testdata/`)
- Go build commands (`go build`, `go vet`, `golangci-lint run`)
- Go naming conventions (exported = PascalCase, unexported = camelCase)
- Go project structure conventions (`cmd/`, `internal/`, `pkg/`)

---

## Test Fixture

**Location:** `packages/sourcevision/tests/fixtures/go-project/`

A minimal Go project modeling a layered HTTP API:

```
go-project/
  go.mod                           # Module: github.com/example/go-project
  cmd/api/
    main.go                        # Entry point
  internal/
    handler/user.go                # HTTP handlers (chi routes)
    handler/user_test.go           # Handler tests
    service/user.go                # Business logic
    service/user_test.go           # Service tests
    repository/user.go             # Data access
    repository/user_test.go        # Repository tests
    middleware/auth.go             # Auth middleware
    middleware/logging.go          # Logging middleware
    config/config.go              # Configuration loading
  pkg/response/json.go            # Shared response utilities
  testdata/users.json             # Test fixtures
```

Exercises: entry point detection, standard Go layout, all archetype categories, test/generated file classification, import graph construction, route detection, and zone boundary formation.

A mixed-language fixture (`tests/fixtures/mixed-go-ts/`) also exists for multi-language detection testing.

---

## Known Limitations

### Parser Limitations
- **Regex-based** — no full AST. Build-tag-gated imports (`//go:build linux`) are extracted regardless of platform. CGo imports (`import "C"`) are classified as stdlib.
- **No symbol extraction** — all imports record `symbols: ["*"]` because Go imports entire packages. This is accurate to Go semantics but means the import graph cannot distinguish which specific exports are used.

### Zone Detection Limitations
- **Package-level granularity** — zones align with Go packages. A 50-file package appears as a single cluster. Sub-package splitting requires function-level call graph analysis (Phase 4).
- **Intra-package cohesion** — Go files in the same package never import each other, so cohesion is computed from shared outgoing edges and proximity, not internal edges.

### Hench Limitations
- **Guard template is manual** — the `go-project` template must be selected during `ndx init` or configured in `.hench/config.json`. Auto-detection from `go.mod` during `hench run` is not implemented.
- **No Makefile target scanning** — `make` is in the allowed commands but Hench doesn't discover available targets from `Makefile`.

### Not Implemented (Phase 4)
- Function-level call graph via `go/ast` or `gopls`
- Interface and struct cataloging
- Go-specific findings (large interfaces, package naming violations, stuttering)
- `go.work` multi-module workspace support
