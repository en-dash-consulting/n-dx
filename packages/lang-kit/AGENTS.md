## lang-kit

`@n-dx/lang-kit` is the foundation tier's language package: pure language facts
and the pack contract that sourcevision's engine and language packs share.

### Rules

- **Imports nothing from `@n-dx/*`.** No dependencies beyond Node: the
  package declares no `dependencies`. `tests/e2e/architecture-policy.test.js`
  fails on either.
- **Pure.** It never reads config, the filesystem layout or the environment on
  its own; callers pass in what it needs.
- **No language SDK at run time.** Nothing here may require a toolchain
  (JDK, Go, Terraform) to be installed.
- **One public entry**, `.` (`src/index.ts`). There is no `./dist/*` escape hatch.

### What it will hold

Language ids and configs, file-to-language detection, build-file readers and
the small TOML/XML/YAML parsers, the IaC resource-kind table, and the facts-out
pack contract. Resolvers, the parser runner, pack loading, queries and grammars
stay in sourcevision. Domain packages import it directly, as they do
`@n-dx/llm-client`; hench and web have no gateway for it.
