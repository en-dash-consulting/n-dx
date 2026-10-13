## lang-runtime

`@n-dx/lang-runtime` is the tree-sitter runtime: `web-tree-sitter`, the runner (`runner.ts`), the tree-sitter pack types (grammar locator, queries, captures, resolvers, rule provenance), grammar availability checks, the call-grouping and captures-to-facts helpers, the pinned grammar build script and the golden-test harness.

### Rules

- **Imports only `@n-dx/lang-kit` from n-dx.** Its one runtime dependency beyond that is `web-tree-sitter`.
- **Only packs load it.** sourcevision, rex, hench, web and core never import it, so an install without packs never pays for the parser.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

The code arrives in the tasks of the parser-runtime feature under the language-packs epic; until then this package holds a placeholder export.
