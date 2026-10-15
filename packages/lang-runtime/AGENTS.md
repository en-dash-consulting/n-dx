## lang-runtime

`@n-dx/lang-runtime` is the tree-sitter runtime: `web-tree-sitter`, the runner (`runner.ts`), the tree-sitter pack types (grammar locator, queries, captures, resolvers, rule provenance), grammar availability checks, the call-grouping and captures-to-facts helpers, the pinned grammar build script and the golden-test harness.

### Rules

- **Imports only `@n-dx/lang-kit` from n-dx.** Its one runtime dependency beyond that is `web-tree-sitter`.
- **Only packs load it.** sourcevision, rex, hench, web and core never import it, so an install without packs never pays for the parser.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

- **Callers supply every path.** `loadLanguagePacks` takes the packs, the grammar directory and the missing-grammar notice step from its caller; `readPackFacts` and `factGaps` take the pack's symbol rules (and `factGaps` its project facts reader, which `createPackEntry` runs once over every parsed file for kinds no single file answers, such as Terraform's `resources`); `packPackage` takes the pack's name and root. The one directory named here is the pack's sibling `lang-runtime/scripts`, which tells a source checkout from an install.

### What it holds

`src/pack.ts` (the tree-sitter pack contract and grammar availability), `src/runner.ts`, `src/pack-calls.ts`, `src/pack-facts.ts`, `src/pack-package.ts` (a pack package's version, grammar and query directories and notice remedies, from its root), `src/pack-entry.ts` (`createPackEntry`: lang-kit's `LanguagePackEntry` for a tree-sitter pack — grammar, queries and build-file failures come back as its `degraded` notice, never thrown; a pack's `frameworks` (`FrameworkPack`, e.g. lang-java's Spring Boot) add their queries to the same parse only when a kind they produce is wanted, and their skips come back as `notices`), and the pack test helpers in `src/testing/` (`skipUnlessGrammar`, the golden harness), all exported from the barrel.

`scripts/build-grammars.mjs --out <dir> [<name>...]` builds the pinned grammars to WASM. Each grammar belongs to exactly one pack, which runs the script from its `build:grammars` script into its own `build/grammars`; `--out` is required, so a bare run builds nothing. Its download cache is this package's `build/`. `scripts/update-pack-goldens.mjs` is each pack's `test:update-goldens`.
