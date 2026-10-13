## lang-runtime

`@n-dx/lang-runtime` is the tree-sitter runtime: `web-tree-sitter`, the runner (`runner.ts`), the tree-sitter pack types (grammar locator, queries, captures, resolvers, rule provenance), grammar availability checks, the call-grouping and captures-to-facts helpers, the pinned grammar build script and the golden-test harness.

### Rules

- **Imports only `@n-dx/lang-kit` from n-dx.** Its one runtime dependency beyond that is `web-tree-sitter`.
- **Only packs load it.** sourcevision, rex, hench, web and core never import it, so an install without packs never pays for the parser.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

- **Callers supply every path.** `loadLanguagePacks` takes the packs, the grammar directory and the missing-grammar notice step from its caller; `readPackFacts` and `factGaps` take the pack's symbol rules. No module here names another package's directory.

### What it holds

`src/pack.ts` (the pack contract and grammar availability), `src/runner.ts`, `src/pack-calls.ts`, `src/pack-facts.ts`, and the pack test helpers in `src/testing/` (`skipUnlessGrammar`, the golden harness), all exported from the barrel.

`scripts/build-grammars.mjs [--out <dir>] [<name>...]` builds the pinned grammars to WASM. With no `--out` it still writes `packages/sourcevision/build/grammars`, where sourcevision's built-in packs read them, until each pack builds its own; its download cache is this package's `build/`.

Until the last task of the parser-runtime feature, sourcevision imports this package directly (it is a devDependency there); the "only packs load it" rule above is where that feature ends.
