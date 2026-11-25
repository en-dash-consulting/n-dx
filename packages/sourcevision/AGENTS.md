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
2. **Refused** when its version differs from sourcevision's (`package.json`
   before import, then the entry; a copy only in another version's directory
   counts) or it exports no matching lang-kit `LanguagePackEntry`. The notice
   names `ndx sv pack add <lang>` (`packInstallCommand`).
3. **Degraded** when it is missing, refused, reports `degraded` (grammar not
   built or not loadable, a query that will not compile, unreadable build
   files) or its `analyzeProject` rejects. `src/analyzers/pack-imports.ts`
   reports it once per run: Java files get inventory only, Go edges come from
   the regex parser (`src/analyzers/go-imports.ts`).
   `src/analyzers/terraform-infrastructure.ts` reports Terraform's once, only
   when `infrastructure.json` lists a `.tf` resource: those get no model fields. Analysis never fails on a
   pack. A missing, unlisted opt-in pack (`isSuggestedPack`) only joins
   analyze's end-of-run `Optional packs` line.

### Python

`.py` and `.pyi` are parseable (`pythonConfig.parseableExtensions`) only
through `@n-dx/lang-python`, an opt-in `KNOWN_PACKS` entry with no fallback
parser: without it, Python files get inventory only and every artifact is
unchanged. With
it, Python edges and externals reach `imports.json` through
`buildPackImportGraph` like Go's and Java's (externals as
`python:[stdlib:]<module>`, Java's `java:[stdlib:]<package>`, so no two
languages' names merge; a
`TYPE_CHECKING`-only target as a `type` edge), so Python files join zones;
a Python repository beside TypeScript (root `pyproject.toml` and
`package.json`) gets both. Inventory, not knowing whether a pack loads,
leaves Python and Java out of `analysedLanguages`; the imports phase adds the
packs that ran (`withPackAnalysedLanguages`), so a re-run
without the pack drops it; inventory.json is untouched if nothing changes. Its dynamic-import and past-root notices go to `warn`. Over the pinned corpus (`python-corpus.json`),
`scripts/python-corpus-report.mjs` measures the pack, `python-build-report.mjs`
lang-kit's build readers, `python-resolve-report.mjs` the resolver, and
`python-routes-report.mjs` and `python-outbound-report.mjs` the route and
outbound rules; the last three print a hand-check sample. With the pack, components.json gains a `serverRoutes` group per
Python file with routes (and `totalServerRoutes`), and
outbound.json a dependency per Python outbound call; no sourcevision code
is Python-specific.

### PHP

`@n-dx/lang-php` is an opt-in `KNOWN_PACKS` entry with no fallback parser.
Installed and running, its `use` imports, class references and computable
includes reach imports.json through `buildPackImportGraph` as edges
(Composer autoload, PHP's include search order) and
`php:<namespace>` externals, other languages' entries unchanged, and it joins
`analysedLanguages`; missing and unlisted, it is only suggested and every
artifact is unchanged (`tests/integration/php-pack-imports.test.ts`). Over
the pinned corpus (`php-corpus.json`, `php5` marking the PHP 5 era
repositories), `scripts/php-corpus-report.mjs` measures the clean-parse rate
(the PHP 5 repositories against decision D4's 99.5% bar) and
`scripts/php-resolve-report.mjs` the resolver; each script's header says
what it prints.

### The Terraform model in infrastructure.json

`enrichTerraformInfrastructure` (after `computeInfrastructure`) only adds
optional fields to resources already listed, as written; it never adds or
removes a resource, link or seam, and without the pack the file is
byte-identical. Fields and rules:
[Terraform pack facts](../../docs/packages/sourcevision.md#terraform-pack-facts).

### Pack routes and outbound calls

A pack producing `routes` or `outboundCalls` (Java, through its Spring Boot
rules; Python, `routes` through its FastAPI, Flask and Django rules and
`outboundCalls` through its python-clients rules; PHP, `routes` from docroots and
`.htaccess`, each `source` kept in `ServerRoute.source`, and `outboundCalls`) is asked for them in the imports phase's one `analyzeProject` call
(`PackImportsOptions.framework`), so no file is parsed twice; the facts ride
on `AnalyzeContext.packFacts`. A run without the imports phase (`--phase`,
`sv narrate`) reads them with `readImportsPackFrameworkFacts`. `src/analyzers/pack-framework-facts.ts`
merges them: `withPackRouteGroups` (the one call in `analyzeComponents`) adds
one `ServerRouteGroup` per file to `serverRoutes`, a method-less route recorded
as `GET`; `withPackOutbound` (in `analyze`'s output step) adds an
`OutboundDependency` per call, `inferred` when the fact has no confidence. Both
reuse the detectors' role sets (`ROUTE_SKIP_ROLES`, outbound's `SKIP_ROLES`),
prefix rule and order, and return their input itself when nothing is added.
Pack `notices` go to the same `warn` as degrade notices.

`entryPoints` facts (PHP's CLI and cron scripts) ride the same call and
`packFacts`; `packEntryPointSignals` turns each into an `entrypoint` signal
that `analyzeClassifications` scores (weight 1), recorded as evidence with
`signalKind` `pack` and a detail such as `cron entry point: 0 3 * * *
(crontab:4)`; the schedule lives only in that detail. A file with pack signals, or pack evidence last run, is always
reclassified. Without facts classifications.json is unchanged.

`configReads` and `flagChecks` become config.json, `versionFloor`,
`legacyConstructs` and `dynamicCode` sdlc-profile.json's `ecosystem` (`pack-ecosystem.ts`):
config facts, legacy constructs and dynamic code only when present, the version-floor
histogram whenever the pack was asked for floors (`PackFrameworkFact.asked`),
even with none found. The same facts, per file, become legacy.json
(`pack-legacy-files.ts`, ecosystem's own/third-party split) and sites.json
(`pack-sites-files.ts`, each dynamic-code site), only when present.

### Terraform as a database-engine source

`language/database-engines.ts` takes the Terraform pack's resource facts from
its caller (today only `scripts/database-corpus-report.mjs`); it imports no
pack, is not wired into `analyze` and writes nothing. Engine strings and
resource types live in `TERRAFORM_ENGINE_TABLE` and `TERRAFORM_RESOURCE_TABLE`,
each entry with its provider page. Signal strengths:
[Terraform pack facts](../../docs/packages/sourcevision.md#terraform-pack-facts).

### How packs are installed

`sv pack` (`src/cli/commands/pack.ts`) manages the pack directory for every
pack in `INSTALLABLE_PACKS`; npm always runs with `--ignore-scripts`. The
command lines, offline bundles and archive rules are in
`docs/packages/sourcevision.md` (Pack installation internals); add new
`sv pack` detail there, not here.

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
