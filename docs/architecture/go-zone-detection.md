# Go Zone Detection: Behavior, Edge Semantics, and Limitations

> **Status:** Phase 2 — delivered
> **Canonical test:** [`packages/sourcevision/tests/integration/go-zones.test.ts`](../../packages/sourcevision/tests/integration/go-zones.test.ts)
> **Related:** [go-integration-plan.md](./go-integration-plan.md), [zone-naming-conventions.md](./zone-naming-conventions.md)

---

## Overview

SourceVision's zone detection uses Louvain community detection on the import graph to cluster files into architectural zones. The algorithm is language-agnostic — it operates on nodes (files) and weighted edges (imports). Go support feeds into this same pipeline, but the **shape of the import edges differs from JS/TS**, which affects zone granularity, crossing detection, and zone naming.

---

## Edge Semantics: Go vs JS/TS

The fundamental difference is what an import edge **points to**.

### JS/TS: file-to-file edges

JS/TS imports resolve to individual files. The import analyzer traces each `import` statement to a specific `.ts` or `.js` file on disk:

```
src/routes/users.ts  →  src/services/user-service.ts     (file → file)
src/routes/users.ts  →  src/models/user.ts                (file → file)
```

Every edge endpoint is a file that exists in the inventory, so both endpoints participate in Louvain clustering and crossing computation.

### Go: file-to-package edges

Go imports target **packages** (directories), not individual files. The Go import parser resolves internal imports by stripping the module path from `go.mod` and producing a relative directory path:

```go
// In cmd/api/main.go:
import "github.com/example/go-project/internal/handler"
```

Produces the edge:

```
cmd/api/main.go  →  internal/handler     (file → directory)
```

The `from` field is a file path; the `to` field is a directory path. This is a direct consequence of Go's package system: a Go import statement like `import "module/internal/handler"` imports the **entire package** (all exported symbols from all `.go` files in that directory), not a specific file.

### Concrete example

Consider the Go fixture project's dependency chain:

```
cmd/api/main.go         → internal/handler     (directory)
internal/handler/user.go → internal/service      (directory)
internal/service/user.go → internal/repository   (directory)
```

The equivalent JS/TS project would produce:

```
src/cmd/api/main.ts         → src/handler/user.ts       (file)
src/handler/user.ts          → src/service/user.ts       (file)
src/service/user.ts          → src/repository/user.ts    (file)
```

---

## Impact on Zone Detection

### Zone clustering works well

The Louvain algorithm clusters nodes that share dense internal connections. For zone formation, Go's file-to-package edges are effective because:

1. **Multiple files in a package share outgoing edges** — if `handler/user.go` and `handler/admin.go` both import `internal/service`, they cluster together.
2. **Directory proximity edges** fill gaps — files in the same directory with no import edges receive chain-topology proximity edges, reinforcing package-level grouping.
3. **Go's package structure maps naturally to zones** — the convention of `cmd/`, `internal/handler/`, `internal/service/`, `pkg/response/` produces clear community boundaries.

### Zone granularity: package-level, not file-level

Because Go edges target directories rather than individual files, the zone algorithm cannot distinguish between files within a target package. If `internal/service/` contains `user.go`, `order.go`, and `product.go`, they all receive the same inbound edge weight from `handler/user.go → internal/service`. This means:

- **Zones tend to align with Go packages** — files in the same Go package almost always land in the same zone.
- **Splitting a large Go package into sub-zones is unlikely** unless the package has internal import diversity (rare in Go, since intra-package imports don't exist).
- **Granularity is coarser than JS/TS** — a JS/TS project might split `services/` into multiple zones based on which specific service files import which. Go cannot make this distinction.

This is generally a good fit for Go codebases, where the package is the primary unit of encapsulation.

### Crossings may be sparse or empty

Zone crossings record edges that span zone boundaries. The crossing builder matches `edge.from` and `edge.to` against the file-to-zone map:

```typescript
const fromZone = fileToZone.get(edge.from);   // ✅ file path — always matches
const toZone = fileToZone.get(edge.to);        // ❌ directory path — no match
```

Since `edge.to` for Go imports is a directory (e.g., `internal/service`), and the file-to-zone map contains file paths (e.g., `internal/service/user.go`), the lookup returns `undefined`. **Crossings will be empty or sparse** for Go projects, even when the import graph clearly shows cross-package dependencies.

The `go-zones.test.ts` integration test validates this explicitly:

```typescript
it("crossings array is present (may be empty for Go directory-level imports)", () => {
  expect(Array.isArray(zones.crossings)).toBe(true);
});
```

The test validates structural correctness of whatever crossings exist, but does not require a minimum count.

---

## Zone Naming for Go

Zone IDs are derived from the most common non-generic directory segment among the zone's files. The following segments are treated as generic and skipped:

```
src, lib, app, packages, internal, pkg, tests, test, spec, specs, mocks
```

Critically, **`internal` and `pkg` are in this skip list**, which means Go files get meaningful zone IDs:

| File path | Zone ID | Reasoning |
|-----------|---------|-----------|
| `internal/handler/user.go` | `handler` | `internal` skipped → `handler` is the first non-generic segment |
| `internal/service/user.go` | `service` | `internal` skipped → `service` |
| `internal/repository/user.go` | `repository` | `internal` skipped → `repository` |
| `pkg/response/json.go` | `response` | `pkg` skipped → `response` |
| `cmd/api/main.go` | `api` or `cmd` | `cmd` is not in the skip list, so it may appear as the zone ID depending on clustering |

Zone names are derived from IDs by converting to title case: `handler` → **Handler**, `service` → **Service**.

When disambiguation is needed (multiple communities with the same base ID), the algorithm appends the next non-generic path segment: e.g., `handler-v1` and `handler-v2`.

---

## Known Limitations

### 1. Package-level granularity only

Go import edges resolve to package directories, not individual files. The zone algorithm cannot distinguish which specific file within a target package is being used. This means:

- All files in a Go package are treated as a single cluster target.
- Sub-file architectural patterns (e.g., "the handler calls the `CreateUser` function in the service, not the `DeleteUser` function") are invisible to zone detection.
- A Go package with 50 files will appear as one unit in the import graph, even if internal sub-groups exist.

**Workaround:** None currently. A future function-level call graph (Phase 4 — see [go-integration-plan.md](./go-integration-plan.md)) could provide finer granularity.

### 2. No function-level call graph

The Go import parser extracts package-level dependencies only. It does not analyze:

- Which exported functions/types are actually used by importers
- Method call chains across packages
- Interface satisfaction relationships (which struct implements which interface)

This limits zone detection to structural boundaries (package → package) rather than behavioral boundaries (function → function).

### 3. Sparse crossing data

As described above, zone crossings rely on matching edge endpoints against the file-to-zone map. Since Go edge targets are directories, most crossings will not be recorded. This means:

- Coupling metrics derived from crossings may undercount actual cross-zone dependencies.
- The `crossings` array in the zones output may be empty even for projects with rich inter-package imports.
- Dashboard visualizations that depend on crossings for edge rendering may show fewer connections for Go projects than for JS/TS projects.

### 4. Fragmented zones in large Go monorepos

Go monorepos with many small packages (e.g., a microservices project with 50+ `cmd/` subdirectories) may produce fragmented zone output:

- Small packages with few files may be merged into neighbors by the `mergeSmallCommunities` post-processing step (threshold: < 3 files).
- Very large monorepos may hit the zone count cap (default: 30, scaled by file count), causing aggressive merging.
- The linear dependency chains common in Go (`cmd → handler → service → repo`) can cause Louvain to merge adjacent layers when the total file count is small.

### 5. Regex-based parsing limitations

The Go import parser uses regex-based extraction rather than a full Go AST parser. Edge cases that may not be handled:

- Build-tag-gated imports (`//go:build linux`) — the parser extracts all imports regardless of build tags, which may include platform-specific packages that aren't relevant on the current OS.
- Multi-line raw string literals containing `import`-like patterns — unlikely in practice but theoretically possible.
- CGo imports (`import "C"`) — treated as stdlib; the actual C dependencies are not tracked.

### 6. External dependency classification heuristic

Standard library detection uses the "no dot in first path segment" heuristic:

```
fmt           → stdlib  (no dot in "fmt")
net/http      → stdlib  (no dot in "net")
github.com/…  → third-party (dot in "github.com")
golang.org/x/… → third-party (dot in "golang.org")
```

This heuristic is accurate for all standard Go toolchains but could misclassify imports from non-standard module proxies or local replace directives that use domain-less paths.

---

## Validation

The canonical end-to-end test for Go zone detection is [`go-zones.test.ts`](../../packages/sourcevision/tests/integration/go-zones.test.ts). It validates:

| Assertion | What it catches |
|-----------|----------------|
| Import graph has ≥ 1 edge | Silent parser regression (zero edges → degenerate single mega-zone) |
| Schema-valid output | Structural integrity of the zones JSON |
| ≥ 2 distinct zones | Algorithm producing meaningful communities, not a single blob |
| Package boundary coverage | Files from `cmd/`, `handler/`, `service/`, `repository/`, `pkg/response/` all appear in zones |
| Non-adjacent package separation | At least one pair of non-directly-connected packages lands in different zones |
| Metric ranges | Cohesion and coupling ∈ [0, 1] for all zones |
| No duplicate file assignment | Each file appears in exactly one zone |
| Crossing structural validity | All crossing `fromZone`/`toZone` fields reference real zone IDs |
| Determinism | Identical output across repeated runs on the same fixture |

The test operates on the Go fixture project at `packages/sourcevision/tests/fixtures/go-project/`, which models a typical layered Go application:

```
cmd/api/          → handler → service → repository
                              ↑
pkg/response/     (shared utilities)
internal/config/  (configuration)
internal/middleware/ (HTTP middleware)
```

---

## Comparison Summary

| Aspect | JS/TS | Go |
|--------|-------|----|
| Edge target | Individual file | Package directory |
| Edge resolution | Complex (strip `.js`, probe `.ts`/`.tsx`, resolve `index.ts`) | Simple (strip `go.mod` module prefix → relative dir) |
| Import types used | `static`, `dynamic`, `require`, `reexport`, `type` | `static` only |
| Zone granularity | File-level (can split within a directory) | Package-level (directory = cluster unit) |
| Crossings | Rich (file-to-file matches) | Sparse (directory targets don't match file map) |
| External classification | npm package name | stdlib (no dot) vs third-party (has dot) |
| Blank/side-effect imports | Not applicable | `import _ "pkg"` — edge created, symbols `["*"]` |
| Dot imports | Not standard | `import . "pkg"` — edge created, symbols `["*"]` |
| Aliased imports | Via bundler config | `import alias "pkg"` — alias recorded in symbols |
