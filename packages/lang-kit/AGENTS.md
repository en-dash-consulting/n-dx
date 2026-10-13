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

### What it holds

Language ids and configs, file-to-language detection, build-file readers and
the small TOML/XML/YAML parsers, and the IaC resource-kind table (`IAC_KINDS`,
which the iso-map bundle aliases to `src/iac-kinds.ts` alone); the facts-out
pack contract is to follow. Detection takes the config override and the
Terraform file search as arguments (`detectLanguage(rootDir, { override,
hasTerraformFile })`); sourcevision's `src/language/detect.ts` supplies both. Resolvers, the parser runner, pack loading, queries and grammars
stay in sourcevision. Domain packages import it directly, as they do
`@n-dx/llm-client`; hench and web have no gateway for it.
