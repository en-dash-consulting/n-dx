## lang-terraform

`@n-dx/lang-terraform` is the Terraform pack: the pinned tree-sitter-hcl grammar, the structure queries and the in-memory Terraform model, returned as lang-kit `resources` facts.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Opt-in, and not wired into analyze.** sourcevision finds this package at run time (when it is wired) and imports it dynamically; nothing imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Facts out, model in memory.** `pack` (`src/pack.ts`) is a lang-kit `LanguagePackEntry` producing `resources`. The queries (`queries/terraform/*.scm`, one per construct) feed `buildTerraformModel` (`src/terraform-model.ts`), which works over the whole project because a module call joins directories; lang-runtime's `projectFacts` hook runs it once per analysis, and `src/terraform-facts.ts` turns managed resources into `ResourceFact`s with `module`, `provider`, `references` and `attributes`. Data sources, module calls, variables and the reference graph stay in the model. No tree-sitter type crosses into sourcevision. `terraformPack`, `terraformGrammarPath` and the model serve the corpus script in `packages/sourcevision/scripts` and tests in the workspace.
- **Values as written.** Attribute values and versions are never normalised here (`valueAsWritten`). The audit-attribute table (`AUDIT_ATTRIBUTE_RULES`) and the registry-module table (`REGISTRY_MODULES`, only entries checked against a pinned checkout) carry provenance per entry, as each query does.
- **Module paths.** A resource's `module` is the shortest call path from a root module (a directory no followed local call reaches), then the alphabetically first; absent at a root.
- **Module instances.** `model.instances` lists every root and, depth first, every call path from it (a call into a directory already on the path is skipped; at most `MAX_MODULE_INSTANCES`). `src/terraform-resolve.ts` resolves an audit attribute written as an expression in each instance: `var.x` (the call's argument, resolved in the caller, else a plain-string `default`), `local.x`, and `cond ? null : e` / `cond ? e : null` (`conditional`). Strings only; nothing is evaluated. Each distinct resolution is its own fact with `instance` (path, root call site, per-attribute `resolved` with `written`, `confidence`, `from`); instances that resolve nothing share the as-written fact.
- **Detection stays elsewhere.** Terraform detection, the inventory and the Terraform file set live in `@n-dx/lang-kit` and sourcevision; `IAC_KINDS` and `analyzers/infrastructure.ts` are not this package's.
- **Finds its assets from its own root** (`src/package-paths.ts`): the grammar in `build/grammars`, the queries in `queries/terraform`.
- **No language SDK at run time.** Grammars ship prebuilt as WASM; nothing here may require a toolchain (JDK, Go, Terraform) on the user's machine.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

### Scripts

`build:grammars` builds the grammar into `build/grammars` (CI and release run every package's before tests and publish); the grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`. `test:update-goldens` rewrites the fixture's capture golden (`golden.json`) and model golden (`model.json`) under `tests/fixtures/language-packs/terraform`.
