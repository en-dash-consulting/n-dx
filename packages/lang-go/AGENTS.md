## lang-go

`@n-dx/lang-go` is the Go pack: the pinned tree-sitter-go grammar, `queries/go`, the pack definition and its symbol rules (`src/go-pack.ts`), the Go resolver, the embedded-SQL reader and the Go goldens. It installs by default as an optional dependency of `@n-dx/sourcevision`; without it, Go edges come from sourcevision's regex parser.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Loaded, never imported.** sourcevision finds this package at run time (`src/language/pack-loader.ts`: the per-user pack directory, then module resolution) and imports it dynamically; nothing in a package's `src` imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Returns facts.** `pack` (`src/pack.ts`) is a lang-kit `LanguagePackEntry` built with lang-runtime's `createPackEntry`, and it is the only export sourcevision reads; no tree-sitter type crosses into sourcevision. The other exports (the tree-sitter pack, resolver, symbol rules, SQL reader, `goGrammarPath`) serve the corpus scripts in `packages/sourcevision/scripts` and tests in the workspace.
- **Finds its assets from its own root** (`src/package-paths.ts`): the grammar in `build/grammars`, queries in `queries/go`.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

### Scripts

`build:grammars` builds the grammar into `build/grammars` (CI and release run every package's before tests and publish); the grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`. `test:update-goldens` rewrites `tests/fixtures/language-packs/go/golden.json`; review the diff. Parity with sourcevision's regex parser is tested in sourcevision (`tests/integration/go-pack-regex-parity.test.ts`), since a pack never depends on sourcevision.
