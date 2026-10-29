## lang-runtime

`@n-dx/lang-runtime` is the tree-sitter runtime: `web-tree-sitter`, the runner (`runner.ts`), the tree-sitter pack types (grammar locator, queries, captures, resolvers, rule provenance), grammar availability checks, the call-grouping and captures-to-facts helpers, the pinned grammar build script and the golden-test harness.

### Rules

- **Imports only `@n-dx/lang-kit` from n-dx.** Its one runtime dependency beyond that is `web-tree-sitter`.
- **Only packs load it.** sourcevision, rex, hench, web and core never import it, so an install without packs never pays for the parser.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

- **Callers supply every path.** `loadLanguagePacks` takes the packs, the grammar directory and the missing-grammar notice step from its caller; `readPackFacts` and `factGaps` take the pack's symbol rules (and `factGaps` its project facts reader, which `createPackEntry` runs once over every parsed file for kinds no single file answers, such as Terraform's `resources`); symbol rules may carry a `refine` pass for what a rule cannot say (Python's methods, decorators and `__all__`), and `createPackEntry` takes optional `projectNotices` (Python's dynamic imports), returned after the frameworks' notices and followed by the prepared resolver's own `notices()` (Python's relative imports past their root); a resolver's `forProject(projectDir, files)` gets the request's files, so it can read build files beside them without walking the project; `packPackage` takes the pack's name and root. The one directory named here is the pack's sibling `lang-runtime/scripts`, which tells a source checkout from an install.

### What it holds

`src/pack.ts` (the tree-sitter pack contract and grammar availability), `src/runner.ts`, `src/pack-calls.ts`, `src/pack-facts.ts`, `src/pack-package.ts` (a pack package's version, grammar and query directories and notice remedies, from its root), `src/pack-entry.ts` (`createPackEntry`: lang-kit's `LanguagePackEntry` for a tree-sitter pack — grammar, queries and build-file failures come back as its `degraded` notice, never thrown; a pack's `frameworks` (`FrameworkPack`, e.g. lang-java's Spring Boot, lang-python's FastAPI, Flask and Django) add their queries to the same parse only when a kind they produce is wanted, and their skips come back as `notices`, as does a framework that throws, losing only its own facts; the project facts reader and `projectNotices` are contained the same way, and a symbol `refine` that throws on a file leaves it the rules' symbols, named in one notice, so a language's imports never depend on an optional reader; `read`'s optional third argument, `FrameworkContext`, is the pack's resolver (`resolve`, and `module` for a resolver that names modules), bound to the project whenever a framework runs and prepared once, eagerly for imports or on a framework's first lookup, and the resolver's own notices are returned only when imports are wanted), and the pack test helpers in `src/testing/` (`skipUnlessGrammar`, the golden harness), all exported from the barrel.

`scripts/build-grammars.mjs --out <dir> [<name>...]` builds the pinned grammars to WASM. Each grammar belongs to exactly one pack, which runs the script from its `build:grammars` script into its own `build/grammars`; `--out` is required, so a bare run builds nothing. Every download — grammar sources, the CLI, and the wasi-sdk and binaryen toolchains the CLI compiles with — is SHA-256-pinned in the script, and the toolchains reach the CLI by `TREE_SITTER_WASI_SDK_PATH`/`TREE_SITTER_BINARYEN_PATH` so it downloads nothing itself. Its download cache is this package's `build/`. `scripts/update-pack-goldens.mjs` is each pack's `test:update-goldens`.

An entry may supply `oversizedImportSource`, a complete declaration prefix for
files the runner skips for size. A valid prefix contributes imports only, with
a notice that structure was skipped. Go uses this for generated files so their
imports still resolve against the workspace. The parser's normal size limit
and every other pack's skip behavior remain the same.
