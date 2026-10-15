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
which the iso-map bundle aliases to `src/iac-kinds.ts` alone), and the
facts-out pack contract (`src/pack-contract.ts`): the per-file `FileFacts` a
pack returns, with `PRODUCED_FACT_KINDS` (imports, symbols, calls, resources,
routes, outbound calls) and `DECLARED_FACT_KINDS` (components, typed but not
yet produced). `OutboundCallFact.confidence` means what sourcevision's
`Confidence` means: how sure the pack is that it is an outbound call at all. `ResourceFact`'s optional `module`, `provider`, `references`
and `attributes` are filled by the Terraform pack; attribute values are kept
as written, never normalised, except that an optional `instance` marks a fact
whose attributes were resolved through module calls (one fact per distinct
resolution, each attribute's `written` expression kept in `instance.resolved`). The Python pack fills the optional
`FileReference.typeOnly` (a target reached only under `if TYPE_CHECKING:`,
recorded by sourcevision as a `type` edge), `FileReferences.written` (imports as written, each with an `ImportGuard` when
it might not run), `SymbolFact.decorators` and `SymbolFact.exports`
(`__all__`), and the `variable` symbol kind. The contract names no parser type; `@n-dx/lang-runtime`'s
`src/pack-facts.ts` reads tree-sitter captures into it.

The pack entry (`src/pack-entry.ts`) is the one object a pack package exports
as `pack`: `LanguagePackEntry` carries the package name and version, the
language id and config, `produces`, and `analyzeProject({ projectDir, files,
kinds })`, which returns `FileFacts` per file read, the files it could not
read, optional `notices` for what it read but skipped, and a `degraded` notice
(reason, remedy) when it could not run at all.
It is per project because resolution needs the whole project. Its doc comment
says what each field means for a pack that is not tree-sitter based (a TS/JS
pack on the compiler, a SCIP tier); keep it parser-neutral. sourcevision checks
what it imports with `isLanguagePackEntry`.

The Python build readers (`src/python-build.ts`, `readPythonProjects(projectDir,
files)`) read `pyproject.toml` (PEP 621, PEP 735, Poetry, setuptools, hatch,
uv workspace), `setup.cfg` (`src/ini-lite.ts`), requirements files with
`-r`/`-c` includes (`src/python-requirements.ts`) and the literal arguments of
`setup.py`'s `setup(...)` (`src/python-setup-py.ts`; never executed, a
non-literal is a notice). Projects, includes and uv member globs are matched
against the `files` inventory, not the disk. Dependencies reuse
`BuildDependency` (`group` empty, `artifact` PEP 503-normalised, specifier as
written) with file and line. `parseTomlLocated` gives each value's line.

`src/sql-references.ts` reads table names from embedded SQL text; it is here
so the Java and Go packs share it without depending on each other.

Detection takes the config override and the
Terraform file search as arguments (`detectLanguage(rootDir, { override,
hasTerraformFile })`); sourcevision's `src/language/detect.ts` supplies both.
Resolvers, the parser runner, queries and grammars live in the runtime and the
packs; pack loading lives in sourcevision. Domain packages import it directly,
as they do `@n-dx/llm-client`; hench and web have no gateway for it.
