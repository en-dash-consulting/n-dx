# @n-dx/lang-runtime

## 0.10.5

### Patch Changes

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`966597b`](https://github.com/en-dash-consulting/n-dx/commit/966597bab5a972213e5a2a12edffee0092445a6d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: in a chain of calls such as `$a->b()->c()`, each call's receiver in a pack's call facts is the expression directly before its name, whatever order the query captures it in.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`8aefbe2`](https://github.com/en-dash-consulting/n-dx/commit/8aefbe2a7f24f8ffc67cd1ba86e28ca93ebf33f1) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: a framework pack's context now carries `configFiles`, the configuration text its pack's resolver read beside the sources, and `RouteFact` gains an optional `source` naming where a route was declared outside its handler's code.

- [#1096](https://github.com/en-dash-consulting/n-dx/pull/1096) [`f5b87db`](https://github.com/en-dash-consulting/n-dx/commit/f5b87db435673ff2b7cd145a5b97bd436d081a95) Thanks [@endash-shal](https://github.com/endash-shal)! - Test-only: every package suite can measure line, branch and function coverage with per-line hit counts, and fails below its recorded coverage floor.
  
  `pnpm test:coverage` runs each package's new `test:coverage` script, which writes HTML, lcov and JSON reports to `packages/<pkg>/coverage/`. `pnpm coverage:lines <pkg>` prints how many times the suite executed each line. Shared settings live in `tests/vitest-coverage.mjs`; see TESTING.md, "Code Coverage".

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`0a55de6`](https://github.com/en-dash-consulting/n-dx/commit/0a55de6523e6ace586a206f68cec4ad1b80d4d5d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - PHP 5 files that use `$s{0}` string offsets now keep their includes, calls and symbols, and `imports.json` reports them under `summary.parseIssues.php.legacySyntax`, not as syntax errors.
  
  The PHP 8 grammar cannot parse the curly-brace offset, so these valid legacy files used to lose facts and count as broken. The PHP pack now rewrites each offset to `$s[0]` in place, at the same length so every position is the source's, and parses again. `legacySyntax` counts the files and the rewrites by construct (`brace-offset`), and each offset still counts once as a `curly-offset` legacy construct. Short open tags and `each()` were never parse failures; they stay legacy-construct facts.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`86e8aab`](https://github.com/en-dash-consulting/n-dx/commit/86e8aabd3a8923a40ba44e7ad3649a2688f17862) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: the language pack contract gains `trait`, `namespace` and `constant` symbol kinds, a `conditional` import guard (`IMPORT_GUARDS`) and optional `WrittenImport.candidates` for dynamic includes, which never become import edges. No pack produces them yet, so analyze output is unchanged.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`fa3e4a3`](https://github.com/en-dash-consulting/n-dx/commit/fa3e4a37c721a7fc427248e2973960fb9c68c50f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx sv pack add php` installs the new opt-in `@n-dx/lang-php` pack, and `ndx analyze` suggests it for PHP repositories in its `Optional packs` line.
  
  The pack parses PHP, including PHP 5 pages with `<?php … ?>` blocks between HTML, with a pinned tree-sitter-php 0.25.1 grammar. Without the pack, PHP files get inventory only and analyze output is unchanged. The grammar build script can now build a grammar from a subdirectory of its release archive.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`966597b`](https://github.com/en-dash-consulting/n-dx/commit/966597bab5a972213e5a2a12edffee0092445a6d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The opt-in PHP pack (`ndx sv pack add php`) now reads each PHP file's includes, `use` imports, declarations and calls, including PHP 5 pages with HTML between `<?php` blocks.
  
  Includes inside conditions, loops and functions are marked conditional. Imports are reported as written and not yet linked to files, so `imports.json` gains no PHP edges; with the pack installed, `ndx analyze` lists PHP among the analysed languages.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`228d348`](https://github.com/en-dash-consulting/n-dx/commit/228d348026f1dd4d05585dc308780f539e1cb054) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: a call written with a space or comment before its argument list, such as PHP's `foo ($x)` or `$db->query ($sql)`, keeps its callee and receiver in a pack's call facts.
  
  The name is the one the call holds directly, outside any inner call, that ends last before the list opens; a call whose callee is not a name, such as `foo() ($x)`, still has none.

- [#1065](https://github.com/en-dash-consulting/n-dx/pull/1065) [`1dc0110`](https://github.com/en-dash-consulting/n-dx/commit/1dc01107170e5152c4874798bacd765fa490b8f8) Thanks [@endash-shal](https://github.com/endash-shal)! - Internal: refactor llm-client and the language packs without changing behaviour: shared HTTP retry and child-process settling, one merged project-config loader, vendor failover as a table, and shared span helpers in the packs.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`a4f0ab9`](https://github.com/en-dash-consulting/n-dx/commit/a4f0ab91e1c6a69c86a296edb0e26bd831126f76) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `sv analyze` now reports language-pack files that do not parse cleanly, in one `[<pack>-parse]` line and in `imports.json` `summary.parseIssues`.
  
  The report counts files with syntax errors, files over the parser's 1 MiB limit, unreadable files and files that are not valid UTF-8, with up to 50 sorted example paths for each. It covers every pack the imports phase runs (PHP, Java, Go, Python). Nothing becomes fatal: facts are still read from a file with syntax errors, and a non-UTF-8 file is still parsed. When every file parses cleanly the field is absent and `imports.json` is unchanged. The field names are new and under review.
- Updated dependencies [[`a01e575`](https://github.com/en-dash-consulting/n-dx/commit/a01e5753f70be4774dab4e2a0bcc673e48d13d0c), [`8aefbe2`](https://github.com/en-dash-consulting/n-dx/commit/8aefbe2a7f24f8ffc67cd1ba86e28ca93ebf33f1), [`f5b87db`](https://github.com/en-dash-consulting/n-dx/commit/f5b87db435673ff2b7cd145a5b97bd436d081a95), [`1e55cf9`](https://github.com/en-dash-consulting/n-dx/commit/1e55cf9f2dd1eafa6176f9965cc71e174aef4695), [`98a2c93`](https://github.com/en-dash-consulting/n-dx/commit/98a2c939f2081fe6c3825a5c85fcd629202bfe9e), [`e6b640b`](https://github.com/en-dash-consulting/n-dx/commit/e6b640b9e5956116d088dc775c79159c5d9ca898), [`6bf5241`](https://github.com/en-dash-consulting/n-dx/commit/6bf5241853c8233ce5202eee62aefcee64ca6927), [`9eddb9f`](https://github.com/en-dash-consulting/n-dx/commit/9eddb9f8bcf19d50b2de8662cf11c3e84bfc8fab), [`263d95e`](https://github.com/en-dash-consulting/n-dx/commit/263d95e1bd0d40c52b7e9bab1139a536a3b7b085), [`0c31f42`](https://github.com/en-dash-consulting/n-dx/commit/0c31f4223c595c4ee0d202c64533d411e998e675), [`a592749`](https://github.com/en-dash-consulting/n-dx/commit/a5927499f0f28212f41c6e494490a6c617fd5511), [`0a55de6`](https://github.com/en-dash-consulting/n-dx/commit/0a55de6523e6ace586a206f68cec4ad1b80d4d5d), [`80bcac9`](https://github.com/en-dash-consulting/n-dx/commit/80bcac989a958219ad4d4b2ad61ba1dd68f6e72b), [`f867805`](https://github.com/en-dash-consulting/n-dx/commit/f86780564927ea637da9293cbe34bf042c167921), [`86e8aab`](https://github.com/en-dash-consulting/n-dx/commit/86e8aabd3a8923a40ba44e7ad3649a2688f17862), [`966597b`](https://github.com/en-dash-consulting/n-dx/commit/966597bab5a972213e5a2a12edffee0092445a6d), [`f17f946`](https://github.com/en-dash-consulting/n-dx/commit/f17f94636d3a5d9ca51bb5c8615c720965bc0cc9), [`1dc0110`](https://github.com/en-dash-consulting/n-dx/commit/1dc01107170e5152c4874798bacd765fa490b8f8), [`d4d2866`](https://github.com/en-dash-consulting/n-dx/commit/d4d28664500af935874abbc49084703d7e28871f), [`a4f0ab9`](https://github.com/en-dash-consulting/n-dx/commit/a4f0ab91e1c6a69c86a296edb0e26bd831126f76), [`5e253e4`](https://github.com/en-dash-consulting/n-dx/commit/5e253e4a8e2043ddf5082703e307850f29e1a2ec)]:
  - @n-dx/lang-kit@0.10.5

## 0.10.4

### Patch Changes

- Updated dependencies []:
  - @n-dx/lang-kit@0.10.4

## 0.10.3

### Patch Changes

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`55d304a`](https://github.com/en-dash-consulting/n-dx/commit/55d304a06b9e7547490a64e91888a9c25ac64621) Thanks [@endash-shal](https://github.com/endash-shal)! - Resolve Java inherited member types, method references and visible wildcard imports; recognize interface entry points and additional JDK packages. Match Gradle type-safe project accessors to declared projects. Preserve Go workspace import resolution for oversized generated files and report discovery failures even when no build file was found. Reuse verified extracted grammar toolchains without keeping duplicate archives.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`3edfb23`](https://github.com/en-dash-consulting/n-dx/commit/3edfb2303189207193062818fd0a358a2569e78f) Thanks [@endash-shal](https://github.com/endash-shal)! - The grammar build survives packs building at once over its shared toolchain cache: each build extracts its own copy of a toolchain archive into a directory of its own and renames it into place, uses a copy another build verified meanwhile instead of replacing it, and writes downloads under a temporary name before renaming them. The missing-grammar hint names `pnpm -r --workspace-concurrency=1 run build:grammars`.
- Updated dependencies [[`55d304a`](https://github.com/en-dash-consulting/n-dx/commit/55d304a06b9e7547490a64e91888a9c25ac64621), [`c01c1cf`](https://github.com/en-dash-consulting/n-dx/commit/c01c1cfdd02e8140e19816cdc7532a14536b691d)]:
  - @n-dx/lang-kit@0.10.3

## 0.10.2

### Patch Changes

- Updated dependencies [[`19816b7`](https://github.com/en-dash-consulting/n-dx/commit/19816b719a347f36cb8c96831089836cc62584f7)]:
  - @n-dx/lang-kit@0.10.2

## 0.10.1

### Patch Changes

- [#867](https://github.com/en-dash-consulting/n-dx/pull/867) [`de8bc93`](https://github.com/en-dash-consulting/n-dx/commit/de8bc939849ed25a4376dca29ec18646cc906954) Thanks [@dependabot](https://github.com/apps/dependabot)! - Dependency updates: `@anthropic-ai/sdk` ^0.133.0 → ^0.137.0 (llm-client, hench), `web-tree-sitter` 0.27.0 → 0.27.1 (lang-runtime), and `react` / `react-dom` ^19.3.0 → ^19.3.1 (core, graview-face).
- Updated dependencies []:
  - @n-dx/lang-kit@0.10.1

## 0.10.0

### Patch Changes

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Java and Go analysis now comes from the `@n-dx/lang-java` and `@n-dx/lang-go` packs, which sourcevision loads at run time: first from the per-user pack directory (`<ndx home>/packs/<sourcevision version>/`), then from the normal install. A pack must match sourcevision's version. Without the Java pack, Java files get inventory only and one notice names the install command (`npm install --prefix <pack dir> @n-dx/lang-java@<version>`); without the Go pack, Go imports come from the regex parser. `@n-dx/lang-kit` adds the pack entry type (`LanguagePackEntry`) and the embedded-SQL table reader.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`295506c`](https://github.com/en-dash-consulting/n-dx/commit/295506cedd33d8d0d7ddaabf9b453b33a5b71413) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add the parser runtime (`@n-dx/lang-runtime`) and the Java, Go, SQL and Terraform language packs. sourcevision loads them at run time; the Go pack installs by default as an optional dependency.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`bcb494a`](https://github.com/en-dash-consulting/n-dx/commit/bcb494a54b15ba96c66083129f9191426bcb2b6b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The SQL grammar, its table query and the schema reader move into `@n-dx/lang-sql`, and the HCL grammar pin and build into `@n-dx/lang-terraform` (structure only; it produces no fact kinds yet). Both packs are opt-in and not wired into analysis. `@n-dx/sourcevision` ships no grammar or query. `@n-dx/lang-runtime`'s `build-grammars.mjs` now requires `--out`: each pack builds its own grammar with its `build:grammars` script.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`1bb77bf`](https://github.com/en-dash-consulting/n-dx/commit/1bb77bf3a8e6935295bcc59686fe79990f7a2a73) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Python pack resolves imports: absolute, from-import submodule or attribute, relative, src-layout and namespace-package imports become edges to project files across each project's source roots, so Python files join the import graph and zones, beside TypeScript in a mixed repository. Externals are named `python:<top-level module>`, so npm and PyPI packages of the same name stay apart; stdlib is `python:stdlib:<module>` from a pinned Python 3.13 list, and a third-party module is matched to a declared dependency by PEP 503 name only. A target imported only under `TYPE_CHECKING` is a `type` edge. Without the pack every artifact is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`bf141e2`](https://github.com/en-dash-consulting/n-dx/commit/bf141e29a91a42da1b2b6c184c291650f088ef92) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Python pack reads structure: the pinned tree-sitter-python 0.25.0 grammar, imports as written (relative dots kept, `TYPE_CHECKING` and `ImportError`-guarded imports marked, `from __future__` skipped), classes, functions, methods, decorators, module-level names and literal `__all__`, and calls; dynamic imports are counted in its notices. `ndx sv pack add python` installs it. Its imports are not resolved yet, so Python files still get no edges, and without the pack every artifact is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`7e3cded`](https://github.com/en-dash-consulting/n-dx/commit/7e3cdedf02eb5ac2ef6daeaa11e02e20ef8c8725) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Python pack produces `routes` through FastAPI, Flask and Django framework packs, so a Python repository's routes reach components.json `serverRoutes`. FastAPI `include_router`, Flask `register_blueprint` and Django `include` are followed across files through the pack's resolver, which a framework now receives as an optional third argument to `FrameworkPack.read`. A prefix or path that is not a literal is kept as written in `${expression}` form and counted in a notice; Django REST framework router registrations are counted, not expanded. Without the Python pack, or in a repository without Python, every artifact is unchanged. Pairing call captures (lang-runtime's `callSites`, and the new `innermostEach`) is now n log n rather than quadratic in a file's size, so large files no longer take seconds per framework.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`8e49fb7`](https://github.com/en-dash-consulting/n-dx/commit/8e49fb7984f76c5efc30a2b0d423e02be55aec92) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java pack reads Spring Boot request routes and outbound calls (RestTemplate, WebClient, RestClient, Feign, `java.net.http`, Kafka, JMS, Rabbit, gRPC channels and `System.getenv`). With the pack installed, sourcevision records them in `components.json` server routes and `outbound.json`, reading them in the same parse as Java imports. lang-kit's outbound-call fact gains an optional `confidence`, and lang-runtime's framework-pack slot is implemented.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`df60182`](https://github.com/en-dash-consulting/n-dx/commit/df601824a2589d91c43f469cdffcf777cfb9270e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Terraform pack now reads Terraform. `@n-dx/lang-terraform` ships structure
  queries and an in-memory model of resources, data sources, module calls, provider
  requirements, the backend, variables, outputs, locals and references. Its pack entry
  produces `resources` facts.
  
  `@n-dx/lang-kit` now lists `resources` as a produced fact kind. `ResourceFact` gains
  optional `module`, `provider`, `references` and `attributes` fields. The attributes
  are engine, engine version, runtime, image and cluster version, each kept exactly as
  written, except when the optional `instance` field is set: then an attribute may hold
  the value resolved through that module instance rather than the value as written.
  `instance` carries the call path, the root call site and, per resolved attribute, the
  `written` expression, its `confidence` and the `from` location. A resource gets one
  fact per distinct resolution. `@n-dx/lang-runtime`'s `createPackEntry` takes a
  `projectFacts` reader for fact kinds that need the whole project.
  
  In a Terraform-first repository, Terraform files under `tests/` or `test/` and
  `.tftest.hcl` files now get the test role. Repositories led by any other language
  keep their roles.
  
  With the Terraform pack installed (`ndx sv pack add terraform`), Terraform
  resources that `infrastructure.json` already lists gain optional fields: `module`
  (the module call path, absent in a root module), `provider` (`{ name, version? }`,
  the version constraint as written), `references` (ids of listed resources in the
  same module directory) and `attributes` (`engine`, `engineVersion`, `runtime`,
  `image`, `clusterVersion`). Values are as written; an attribute set through a
  module call keeps its resolved value only when every instance agrees. No resource,
  link or seam is added or removed, and without the pack `infrastructure.json` is
  unchanged. The field names are proposals for review.
  
  Terraform database resources are now a database-engine candidate source alongside
  dependencies, images and config. Those candidates stay in memory and are not
  written to any analysis artifact.
- Updated dependencies [[`fe61362`](https://github.com/en-dash-consulting/n-dx/commit/fe613620a2f05fd1ae1d10008ad054d865850ac2), [`ae7a6cf`](https://github.com/en-dash-consulting/n-dx/commit/ae7a6cfea0ecb476b8ff3df58dc2e7c9cec323f4), [`f0547c4`](https://github.com/en-dash-consulting/n-dx/commit/f0547c402f756734ecf85a26365141d6bc806d03), [`02fb706`](https://github.com/en-dash-consulting/n-dx/commit/02fb706ebe718b2feb133cd5c1c9134bcaf24676), [`1c9ca5e`](https://github.com/en-dash-consulting/n-dx/commit/1c9ca5e4cfcc161657a9958887463b2f8cd37a2a), [`f47ebc5`](https://github.com/en-dash-consulting/n-dx/commit/f47ebc52247e319e1f61e6a77b13701da2c06a8e), [`9ff58a3`](https://github.com/en-dash-consulting/n-dx/commit/9ff58a316861865c0cfe0237b95cbca755375f74), [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f), [`ec5f864`](https://github.com/en-dash-consulting/n-dx/commit/ec5f86406c203d43858144c24e0b8f73a96b64f5), [`1bb77bf`](https://github.com/en-dash-consulting/n-dx/commit/1bb77bf3a8e6935295bcc59686fe79990f7a2a73), [`bf141e2`](https://github.com/en-dash-consulting/n-dx/commit/bf141e29a91a42da1b2b6c184c291650f088ef92), [`f901248`](https://github.com/en-dash-consulting/n-dx/commit/f9012480fce7578a73592eeddc371f472026fed6), [`8e49fb7`](https://github.com/en-dash-consulting/n-dx/commit/8e49fb7984f76c5efc30a2b0d423e02be55aec92), [`df60182`](https://github.com/en-dash-consulting/n-dx/commit/df601824a2589d91c43f469cdffcf777cfb9270e)]:
  - @n-dx/lang-kit@0.10.0
