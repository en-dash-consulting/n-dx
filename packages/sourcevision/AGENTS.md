## sourcevision language packs

sourcevision is a language-neutral engine. It reads language facts through
`@n-dx/lang-kit` and carries no parser runtime, grammar or query: those live
in `@n-dx/lang-runtime` and the `@n-dx/lang-*` packs.

### Rules

- **Packs are loaded, never imported.** Nothing in `src` imports
  `@n-dx/lang-runtime`, `web-tree-sitter` or a pack statically. The only
  references to a pack are the dynamic `import()`s in
  `src/language/pack-loader.ts` (`KNOWN_PACKS`). `tests/e2e/architecture-policy.test.js`
  enforces both.
- **Tests reach packs through the loader too.** `tests/helpers/workspace-pack.ts`
  loads a workspace pack and skips a test whose pack cannot run (grammar not
  built). The suite passes with no grammar built anywhere; tests that need a
  grammar and nothing of sourcevision belong in the pack's own suite.
- **Corpus and comparison scripts** (`scripts/`) import the workspace packs
  through `scripts/workspace-pack.mjs`, never the user's pack directory.

### How a pack is found, refused and degraded

`loadPack` (`src/language/pack-loader.ts`) never throws:

1. **Found** in the per-user pack directory first,
   `<ndx home>/packs/<sourcevision version>/node_modules/<package>` (where
   `npm install --prefix` puts opt-in packs), then by module resolution (the
   optional `@n-dx/lang-go` dependency, or the workspace).
2. **Refused** when its version differs from sourcevision's (checked from
   `package.json` before a pack-directory copy is imported, and again on the
   entry) or when it exports no matching lang-kit `LanguagePackEntry`. The
   notice names `ndx sv pack add <lang>` (`packInstallCommand`).
3. **Degraded** when it is missing, refused, reports `degraded` (grammar not
   built or not loadable, a query that will not compile, unreadable build
   files) or its `analyzeProject` rejects. `src/analyzers/pack-imports.ts`
   reports it once per run: Java files get inventory only, Go edges come from
   the regex parser (`src/analyzers/go-imports.ts`).
   `src/analyzers/terraform-infrastructure.ts` reports a Terraform pack the
   same way, once, and only when `infrastructure.json` lists a resource from a
   `.tf` file: those resources get no model fields. Analysis never fails on a
   pack.

### Python

`.py` and `.pyi` are parseable (`pythonConfig.parseableExtensions`) only
through `@n-dx/lang-python`, an opt-in `KNOWN_PACKS` entry with no fallback
parser: without it, Python files get inventory only and the missing-pack
notice, and every artifact is the same as before Python was a pack. With
it, Python edges and externals reach `imports.json` through
`buildPackImportGraph` like Go's and Java's (stdlib as `stdlib:<module>`, a
`TYPE_CHECKING`-only target as a `type` edge), so Python files join zones;
a Python repository beside TypeScript (root `pyproject.toml` and
`package.json`) gets both. `analyzers/inventory.ts` still leaves Python out
of `analysedLanguages`, since the inventory phase does not know whether the
pack will load. Its dynamic-import and past-root notices go to the same
`warn`. `scripts/python-corpus-report.mjs` measures the pack
over the pinned corpus (`python-corpus.json`), and
`scripts/python-build-report.mjs` runs lang-kit's Python build readers over
it (projects, roots, dependency counts, notices), and
`scripts/python-resolve-report.mjs` the resolver (resolution rates by
outcome and a hand-check sample).

### The Terraform model in infrastructure.json

The Terraform pack produces `resources` facts, not imports.
`enrichTerraformInfrastructure` (called by `analyze` after
`computeInfrastructure`) adds optional `module`, `provider` (`{ name,
version? }`), `references` (`infra:<type>.<name>` ids of listed resources in the
same module directory) and `attributes` (`engine`, `engineVersion`, `runtime`,
`image`, `clusterVersion`) to each resource it lists from a `.tf` file whose file
and `<type>.<name>` match a fact. Values are as written, never normalised; a
field appears only when the pack supplied it. When the pack resolved a
module's attributes per instance (several facts at one declaration), an
attribute is stored resolved only when every instance gives the same value,
else as the expression written. It never adds or removes a
resource, link or seam or changes an existing field, so resources only the
model finds stay out. `analyzers/infrastructure.ts` and `IAC_KINDS` are not
involved, so the iso-map bundle does not change. Without the pack the file is
byte-identical. The field names await Sterling H's review (decision 3).

### Pack routes and outbound calls

A pack producing `routes` or `outboundCalls` (Java, through its Spring Boot
rules) is asked for them in the imports phase's one `analyzeProject` call
(`PackImportsOptions.framework`), so no file is parsed twice; the facts ride
on `AnalyzeContext.packFacts`. A run without the imports phase (`--phase`,
`sv narrate`) reads them once with `readImportsPackFrameworkFacts`, which asks
the same packs for the same files. `src/analyzers/pack-framework-facts.ts`
merges them: `withPackRouteGroups` (the one call in `analyzeComponents`) adds
one `ServerRouteGroup` per file to `serverRoutes`, a method-less route recorded
as `GET`; `withPackOutbound` (in `analyze`'s output step) adds an
`OutboundDependency` per call, `inferred` when the fact has no confidence. Both
reuse the detectors' role sets (`ROUTE_SKIP_ROLES`, outbound's `SKIP_ROLES`),
prefix rule and order, and return their input itself when nothing is added.
Pack `notices` go to the same `warn` as degrade notices.

### Terraform as a database-engine source

`language/database-engines.ts` takes the Terraform pack's resource facts as
`DatabaseEngineInput.terraformFacts`, supplied by the caller (today only
`scripts/database-corpus-report.mjs`); it imports no pack, is not wired into
`analyze` and writes nothing. A database resource yields a `terraform`-signal
candidate: a mapped `engine` (Cloud SQL: `database_version`) is strong, an
engine implied by the type alone (Azure servers) is weak, and a resource that
gives neither (a reusable module's `var.engine` no call resolves) adds a
notice. A reusable module yields one candidate per engine its module calls
pass; the evidence text names where the value is written, and a
`conditional` value (`cond ? null : var.engine`) is weak. Engine strings
and resource types live in `TERRAFORM_ENGINE_TABLE` and
`TERRAFORM_RESOURCE_TABLE`, each entry with its provider page.

### How packs are installed

`sv pack` (`src/cli/commands/pack.ts`, reached as `ndx sv pack …`) manages
the pack directory for every pack in `INSTALLABLE_PACKS` (java, go, terraform,
python, sql; only `KNOWN_PACKS`, all but sql, are analyzed with today):

- `add <lang>` runs `npm install --prefix <pack dir> @n-dx/lang-<lang>@<sourcevision version>`,
  creating the directory, then loads the pack from it with `loadPack`; a
  mismatch, a load failure or a pack npm did not put there is an error carrying
  npm's output. `--dry-run` prints the command.
- `list [--json]` reports each pack as installed (pack directory), resolved
  (module resolution), missing or refused, with its version.
- `remove <lang>` runs `npm uninstall --prefix`; a pack found only by module
  resolution is left alone.

Offline, for a machine with no registry access:

- `bundle <lang> [--out <file>]` (connected machine) runs the same npm install
  into a fresh temporary prefix, loads the pack from it, writes
  `n-dx-pack-bundle.json` (pack, package, version, sourcevision version,
  `platform: "any"`: grammars are WASM) and archives the whole prefix as one
  `.tgz`, default `n-dx-lang-<lang>-<version>.tgz`. The prefix is removed.
- `add <lang> --from <bundle>` makes no npm call. It reads the manifest first
  and refuses a bundle of another pack or version, or an archive that will not
  read (a manifest that is not a JSON object is "not a pack bundle"). It
  extracts into `.sv-pack-stage-*` beside the pack directory and loads the pack
  from there; only then does it rename the staged packages over the installed
  ones, record the pack in the pack directory's `package.json` and load it as
  `add` does. Any failure leaves the previous install untouched.

The archive is written and read in Node (`src/cli/commands/pack-archive.ts`),
not by a `tar` process: regular files and directories only, with pax long
paths; reading refuses links, bad checksums, truncation and any path that is
absolute or contains `..`.

### The project pack list

`sourcevision.packs` in the project config is an array of pack ids, read
through the layout resolver by `loadInventoryConfig` (`src/language/detect.ts`),
so `.ndx/config.json` projects work. It is set by editing the file; core's
`ndx config` does not know the key. It never changes what is analysed:

- `noticeListedPacks` (`src/analyzers/pack-imports.ts`, called by
  `analyzeImports`) reports a listed pack that is missing or refused with the
  `ndx sv pack add <lang>` remedy, once, even when the project has no files of
  that language (a listed pack with files is reported by the normal degrade
  path), and one warning for unknown ids listing the known ones. With `.tf`
  files the imports phase leaves Terraform to `enrichTerraformInfrastructure`
  (its `listed` option), which reports it once: the degrade notice when
  `infrastructure.json` lists a `.tf` resource, the listed-pack notice when not.
- `add` with no language installs each listed pack the loader does not find;
  `list` marks listed packs (`listed` in `--json`).
- No list, an empty list or a non-array: no notice, byte-identical output.

npm runs through llm-client's `spawnCli` (cmd.exe on Windows, for npm's `.cmd`
shim). The runner, pack list, pack directory and importer are injectable; tests
(`tests/unit/cli/pack.test.ts`) use a fake npm and never the network.
