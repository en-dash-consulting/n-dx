## lang-sql

`@n-dx/lang-sql` is the SQL pack: the pinned tree-sitter-sql grammar, `queries/sql` and the schema reader that returns table names as symbol facts.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Opt-in, and not wired into analyze.** sourcevision finds this package at run time (when it is wired) and imports it dynamically; nothing imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Returns facts.** `pack` (`src/pack.ts`) is a lang-kit `LanguagePackEntry` built with lang-runtime's `createPackEntry`; it produces `symbols` (a `CREATE TABLE` is a symbol of kind `table`, rules in `src/sql-facts.ts`). No tree-sitter type crosses into sourcevision. The other exports (the tree-sitter pack, `extractSqlTables`, `sqlGrammarPath`) serve the corpus scripts in `packages/sourcevision/scripts` and tests in the workspace.
- **Pure text stays in sourcevision.** Dialect, migration-tool and database-engine detection (`sql-dialects.ts`, `sql-migrations.ts`, `database-engines.ts`) read text only; if one needs table names it receives them as lang-kit facts and never imports this package.
- **Finds its assets from its own root** (`src/package-paths.ts`): the grammar in `build/grammars`, queries in `queries/sql`.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

### Scripts

`build:grammars` builds the grammar into `build/grammars` (CI and release run every package's before tests and publish); the grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`.
