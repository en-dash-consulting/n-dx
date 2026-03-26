## Summary

Add first-class Go language support to the n-dx toolkit (SourceVision, Rex, Hench), enabling the full `ndx init → analyze → plan → work` workflow on Go codebases.

## Motivation

n-dx was built with a focus on frontend TypeScript/JavaScript projects. Extending to Go is the first step toward multi-language capability. The core architectural analysis pipeline (zone detection, PRD management, agent loop) is fundamentally language-agnostic — the JS/TS specificity is concentrated in SourceVision analyzers and Hench guard configuration.

## Implementation

Delivered across three phases on `feature/lang-discovery`:

### Phase 1: Language Registry & Inventory ✅
- Language registry abstraction (`packages/sourcevision/src/language/`)
- `LanguageConfig` interface with per-language extensions, test patterns, config files, skip dirs
- Configs for Go and TypeScript
- Auto-detection from project markers (`go.mod` → Go, `package.json` → JS/TS)
- `language` field in `.n-dx.json` schema and `Manifest.language`
- Inventory analyzer refactored to consume registry instead of hardcoded constants
- Go files correctly classified: `_test.go` → test, `go.mod` → config, `_gen.go`/`.pb.go` → generated

### Phase 2: Import Graph & Zone Detection ✅
- Regex-based Go import parser (`go-imports.ts`) — handles all syntax variants (single, grouped, aliased, blank, dot)
- Import classification: stdlib (prefixed `stdlib:`), third-party, internal
- `go.mod` module path read once per invocation for internal import resolution
- File-to-package edge semantics (Go imports packages, not files)
- Import analyzer dispatch: `.go` files route to Go parser, `.ts`/`.tsx` to JS/TS parser
- Zone detection validated on PocketBase (843 files → 756 edges, 125 external, 26 zones with real coupling)

### Phase 3: Archetypes, Routes & Hench ✅
- `languages` field on archetype signals — Go patterns on 5 archetypes, React scoping on 4
- Go HTTP route detection (`go-route-detection.ts`) — 6 frameworks (stdlib, chi, gin, echo, fiber, gorilla/mux)
- Rex scanner updates: `parseGoMod()`, `scanGoMod()`, `vendor/` skip, `_test.go` detection
- Hench Go support: `GO_GUARD_DEFAULTS` (go, make, golangci-lint), Go test runner, `buildGoLanguageContext()`, `go-project` template

## Validation

- **PocketBase** (843 files): 756 import edges, 125 external packages, 26 zones with meaningful coupling/cohesion scores
- **grit** (309 files, mixed Go + Next.js): Go edges resolve correctly, identified pre-existing TS path alias limitation (#104)
- ~325+ new test cases across all three phases
- Zero regressions in JS/TS behavior — all pre-existing tests pass

## Documentation

- `docs/architecture/go-integration-discovery.md` — full inventory of JS/TS assumptions
- `docs/architecture/go-integration-plan.md` — phased implementation plan
- `docs/architecture/go-zone-detection.md` — edge semantics and zone behavior for Go
- Phase post-op documents for each phase

## Known Limitations

- No function-level call graph for Go (regex-based, not AST — deferred to Phase 4)
- No interface/struct cataloging (deferred to Phase 4)
- Mixed-language projects detect a primary language; cross-language zone merging not supported
- Route detection is regex-based — deeply nested route groups may miss routes
- Hench `go-project` template requires manual selection
- No `go.work` multi-module workspace support
- No Makefile target scanning

## Related Issues

- #103 — SourceVision UI: Backend-oriented dashboard panels
- #104 — SourceVision: Resolve tsconfig path aliases as internal import edges

## Branch

`feature/lang-discovery`
