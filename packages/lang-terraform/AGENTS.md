## lang-terraform

`@n-dx/lang-terraform` is the Terraform pack: the pinned tree-sitter-hcl grammar and Terraform structure; the resource model comes next.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Opt-in, and not wired into analyze.** sourcevision finds this package at run time (when it is wired) and imports it dynamically; nothing imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Structure only.** `pack` (`src/pack.ts`) is a lang-kit `LanguagePackEntry` that produces no fact kinds yet; the Terraform model and its resources facts come with PR 13. No tree-sitter type crosses into sourcevision. `terraformPack` and `terraformGrammarPath` serve the corpus script in `packages/sourcevision/scripts` and tests in the workspace.
- **Detection stays elsewhere.** Terraform detection, the inventory and the Terraform file set live in `@n-dx/lang-kit` and sourcevision; `IAC_KINDS` and `analyzers/infrastructure.ts` are not this package's.
- **Finds its assets from its own root** (`src/package-paths.ts`): the grammar in `build/grammars`. It has no queries yet.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

### Scripts

`build:grammars` builds the grammar into `build/grammars` (CI and release run every package's before tests and publish); the grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`.
