# @n-dx/lang-kit

## 0.10.5

### Patch Changes

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`a01e575`](https://github.com/en-dash-consulting/n-dx/commit/a01e5753f70be4774dab4e2a0bcc673e48d13d0c) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: the pack contract gains language-neutral `configReads` and `flagChecks` fact kinds, and `sv analyze` writes them to a new `config.json` when a pack produces them.
  
  No pack produces them yet, so every analysis is unchanged and writes no `config.json`. The facts record keys, flag names, files, positions and the lines a flag check gates, never a value; `normalizeFlagName` gives one flag's spellings one name. The dashboard's data-file list names `config.json` so it is served and watched once it exists.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`8aefbe2`](https://github.com/en-dash-consulting/n-dx/commit/8aefbe2a7f24f8ffc67cd1ba86e28ca93ebf33f1) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: a framework pack's context now carries `configFiles`, the configuration text its pack's resolver read beside the sources, and `RouteFact` gains an optional `source` naming where a route was declared outside its handler's code.

- [#1096](https://github.com/en-dash-consulting/n-dx/pull/1096) [`f5b87db`](https://github.com/en-dash-consulting/n-dx/commit/f5b87db435673ff2b7cd145a5b97bd436d081a95) Thanks [@endash-shal](https://github.com/endash-shal)! - Test-only: every package suite can measure line, branch and function coverage with per-line hit counts, and fails below its recorded coverage floor.
  
  `pnpm test:coverage` runs each package's new `test:coverage` script, which writes HTML, lcov and JSON reports to `packages/<pkg>/coverage/`. `pnpm coverage:lines <pkg>` prints how many times the suite executed each line. Shared settings live in `tests/vitest-coverage.mjs`; see TESTING.md, "Code Coverage".

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`1e55cf9`](https://github.com/en-dash-consulting/n-dx/commit/1e55cf9f2dd1eafa6176f9965cc71e174aef4695) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx analyze` now detects a PHP repository whose app sits one folder below the root, such as phpBB's `phpBB/` or osCommerce's `catalog/`, instead of falling back to TypeScript.
  
  With no other language's marker at the root, a `composer.json` or `index.php` in a direct child directory marks PHP; detection never looks deeper. A repository with no marker at all takes the language with the most source files, PHP included, unless that is TypeScript or Terraform files match or outnumber it. Repositories with a root marker, such as `package.json` beside a `php/` folder, keep their detection.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`98a2c93`](https://github.com/en-dash-consulting/n-dx/commit/98a2c939f2081fe6c3825a5c85fcd629202bfe9e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - With the PHP pack, `classifications.json` now marks a legacy PHP application's command-line and cron scripts as entry points.
  
  A script is a CLI entry point when it starts with a `#!/usr/bin/env php` or `#!/usr/bin/php` shebang, or when it sits under `bin/`, `cli/`, `cron/`, `scripts/` or `jobs/` and checks `PHP_SAPI` / `php_sapi_name()` against `'cli'` or reads `$argv`. A script that a `crontab`, `*.cron` or `cron.d/` file in the repository runs with `php` is a cron entry point. Each one is classified `entrypoint`, and its evidence says why: the shebang or check with its line, or the cron schedule as written with the crontab line. A crontab job whose script is not in the repository is reported as a notice. Without the PHP pack, `classifications.json` is unchanged.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`e6b640b`](https://github.com/en-dash-consulting/n-dx/commit/e6b640b9e5956116d088dc775c79159c5d9ca898) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: lang-kit reads Composer metadata as text, for the PHP pack's namespace resolver.
  
  `readComposerProjects` gives one model per `composer.json` in the inventory (a manifest inside another project's vendor directory excluded): name, `require` and `require-dev` as written, `autoload` and `autoload-dev` (PSR-4, PSR-0, classmap, files, exclude-from-classmap) with repository-relative paths, repositories, the vendor directory, and the packages of the `composer.lock` beside it with their autoload blocks. A `composer.lock` is read up to 16 MiB, since a large project's lock outgrows the 1 MiB cap other build files keep. Composer is never run. Malformed JSON or a field of the wrong type is a notice, never an exception.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`6bf5241`](https://github.com/en-dash-consulting/n-dx/commit/6bf5241853c8233ce5202eee62aefcee64ca6927) Thanks [@ryrykeith](https://github.com/ryrykeith)! - With the PHP pack, `sv analyze` marks dynamic-code sites that run or dispatch on database data and names the tables and columns they read.
  
  A site is database-driven when the code `eval` runs, or the callable `call_user_func`, `$f()`, `new $class` or `$obj->$method()` uses, comes from a query result: in the same function or top-level scope (`mysql_fetch_assoc`, `$wpdb->get_results`, `PDOStatement::fetch`, `db_query_range(…)->fetchAssoc()`, `foreach` over a result), or through repository functions and methods that return one, so Drupal 7's menu router dispatch from `menu_router` is found. Each such site lists its tables, `table.column` for a literal SELECT list (`SELECT *` gives the table alone) and the query calls the value comes from, in the new `[php-db-exec]` and `[php-db-dispatch]` notices. A parameter-fed site is never marked, and a flow the analysis cannot decide is left unmarked rather than guessed. Names and locations only, never row data.
  
  The profile's optional `ecosystem.php.dynamicCode.database` counts those sites by kind, table and column; `readiness.json` carries it. The lang-kit `DynamicCodeFact` gains an optional `database`. WordPress's `get_var`, `get_row`, `get_col` and `get_results` now count as embedded-SQL calls. A repository without the PHP pack, or without such a site, writes the same files as before.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`9eddb9f`](https://github.com/en-dash-consulting/n-dx/commit/9eddb9f8bcf19d50b2de8662cf11c3e84bfc8fab) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx analyze` with the PHP pack now reads Drupal's `.module` and `.install` files, so their classes, includes and `eval` sites are reported.
  
  Before, the pack skipped them: a class declared in a `.module` file (Drupal 7's `FieldException`) became a `php:` external, and `php_eval`'s `eval` went unreported. They count as PHP only in a repository detected as PHP; elsewhere they are still not inventoried, and analysis without the pack is unchanged. Drupal's `.theme`, `.profile`, `.engine` and `.test` files are still not read.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`263d95e`](https://github.com/en-dash-consulting/n-dx/commit/263d95e1bd0d40c52b7e9bab1139a536a3b7b085) Thanks [@ryrykeith](https://github.com/ryrykeith)! - With the PHP pack, `sv analyze` reports each place PHP code runs a string as code or chooses what to run from a value.
  
  These are the parts of a legacy app that reading its files alone cannot explain, such as routes kept in a database table or PHP stored in content.
  
  Code run from a string: `eval`, `assert` with a string, `preg_replace` with the `/e` modifier and `create_function`, marked `literal` when the code is written as literals alone. Code chosen by a value: `call_user_func(_array)` and callback built-ins such as `array_map` and `usort` given a variable callable (`[$this, $name]`, never `[$this, 'save']` or a closure), `$f()`, `new $class`, `$obj->$method()` and `$class::$method()`. Each site comes with its file, line, the expression as written and the enclosing function or method, listed in the new `[php-dynamic-exec]` and `[php-dynamic-dispatch]` notices; never a value.
  
  The profile's optional `ecosystem.php.dynamicCode` counts the sites (`sites`, in `files` files) by kind (`kinds`: `exec`, `dispatch`, and `include` for the includes whose path is built at run time) and by construct (`constructs`), with `literal` exec sites counted apart; `readiness.json` carries it. The lang-kit contract gains the `dynamicCode` fact kind (`DynamicCodeFact`, `DYNAMIC_CODE_KINDS`). A repository without the PHP pack, or without such a site, writes the same files as before.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`0c31f42`](https://github.com/en-dash-consulting/n-dx/commit/0c31f4223c595c4ee0d202c64533d411e998e675) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: the PHP pack exports `extractPhpEmbeddedSql`, which reads table names from SQL passed to PHP query and prepare calls through lang-kit's SQL reference extractor, like the Java and Go packs' readers. Nothing is written to an analysis artifact.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`a592749`](https://github.com/en-dash-consulting/n-dx/commit/a5927499f0f28212f41c6e494490a6c617fd5511) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx analyze` now detects PHP repositories as PHP instead of analysing them as TypeScript, and `php` is a valid `language` setting in `ndx config` and on Settings › Project.
  
  A repository is PHP when it has a root `composer.json` (weighed by source count against other markers, as for any language), or, with no other marker, a `.php` file at its root or an `index.php` in `public/`, `web/`, `htdocs/`, `www/` or `public_html/`. A TypeScript repository with a few PHP files keeps its detection. PHP files are inventoried and classified only; no PHP pack exists yet, so imports, zones and every other artifact are unchanged for them.
  
  `.inc`, `.module` and `.install` count as PHP only in a PHP repository. There, `vendor/` is skipped only beside a `composer.json`, so hand-copied libraries in a legacy `vendor/` are inventoried, and `cache/`, `tmp/` and `.phpunit.cache/` are skipped unless they directly hold a `.php` file. `.phtml`, `.php3`, `.php4` and `.php5` files are labelled PHP in every repository.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`0a55de6`](https://github.com/en-dash-consulting/n-dx/commit/0a55de6523e6ace586a206f68cec4ad1b80d4d5d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - PHP 5 files that use `$s{0}` string offsets now keep their includes, calls and symbols, and `imports.json` reports them under `summary.parseIssues.php.legacySyntax`, not as syntax errors.
  
  The PHP 8 grammar cannot parse the curly-brace offset, so these valid legacy files used to lose facts and count as broken. The PHP pack now rewrites each offset to `$s[0]` in place, at the same length so every position is the source's, and parses again. `legacySyntax` counts the files and the rewrites by construct (`brace-offset`), and each offset still counts once as a `curly-offset` legacy construct. Short open tags and `each()` were never parse failures; they stay legacy-construct facts.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`80bcac9`](https://github.com/en-dash-consulting/n-dx/commit/80bcac989a958219ad4d4b2ad61ba1dd68f6e72b) Thanks [@ryrykeith](https://github.com/ryrykeith)! - With the PHP pack, `sv analyze` reports each use of a PHP construct later versions removed or deprecated, and `sdlc-profile.json` and `readiness.json` count them per repository.
  
  Each rule cites the php.net page of every version it names: the migration guide from 5.6 on, the PHP 5 changelog for 5.3 to 5.5. Removed: `mysql_*`, `ereg*`/`split`, ASP and `<script language="php">` tags, call-time pass-by-reference, the `session_register` and magic-quotes functions, `mcrypt_*`, `create_function`, `each()`, `$s{0}` offsets, PHP 4 constructors, `(unset)` and `__autoload`. Deprecated: `${}` interpolation, `utf8_encode`/`utf8_decode` and likely dynamic properties. Short open tags `<?` and `==` between a non-numeric string and a number are review notices, never removals. A call of a function the repository declares itself (a polyfill) is not counted, nor is a `<% %>` JavaScript template (Underscore, EJS) inside a `<script>` element.
  
  The profile's optional `ecosystem.php.legacyConstructs` holds `files`, `uses`, `notices`, per-rule counts (`rules`) and uses by the version that removed (`removedIn`) or deprecated (`deprecatedIn`) them. The lang-kit contract gains the `legacyConstructs` fact kind (`LegacyConstructFact`, `LanguageBoundary`, `LEGACY_STATUSES`). `scripts/php-corpus-report.mjs` counts a file whose only parse errors are `$s{0}` offsets as clean, so they are not counted twice. A repository without the PHP pack, or with no such construct, writes the same files as before.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`f867805`](https://github.com/en-dash-consulting/n-dx/commit/f86780564927ea637da9293cbe34bf042c167921) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `ndx analyze` with the PHP pack no longer stalls on unusual lines in the repository being analysed.
  
  Eleven text patterns that slowed down sharply on long lines are now linear scans. They read `.htaccess` directives, `include_path` settings in `.htaccess`, `php.ini` and `.user.ini`, database connection strings, `PHP_SAPI` checks, trailing slashes in Composer and include paths, and feature-flag names. Results are unchanged. A `.htaccess`, `php.ini` or `.user.ini` line longer than 64 KiB is now skipped and counted in a notice instead of being read.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`86e8aab`](https://github.com/en-dash-consulting/n-dx/commit/86e8aabd3a8923a40ba44e7ad3649a2688f17862) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Internal: the language pack contract gains `trait`, `namespace` and `constant` symbol kinds, a `conditional` import guard (`IMPORT_GUARDS`) and optional `WrittenImport.candidates` for dynamic includes, which never become import edges. No pack produces them yet, so analyze output is unchanged.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`966597b`](https://github.com/en-dash-consulting/n-dx/commit/966597bab5a972213e5a2a12edffee0092445a6d) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The opt-in PHP pack (`ndx sv pack add php`) now reads each PHP file's includes, `use` imports, declarations and calls, including PHP 5 pages with HTML between `<?php` blocks.
  
  Includes inside conditions, loops and functions are marked conditional. Imports are reported as written and not yet linked to files, so `imports.json` gains no PHP edges; with the pack installed, `ndx analyze` lists PHP among the analysed languages.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`f17f946`](https://github.com/en-dash-consulting/n-dx/commit/f17f94636d3a5d9ca51bb5c8615c720965bc0cc9) Thanks [@ryrykeith](https://github.com/ryrykeith)! - With the PHP pack, `sv analyze` reports the oldest PHP version each file's syntax needs, and `sdlc-profile.json` and `readiness.json` count the repository's PHP files by that version.
  
  Each rule dates one construct (namespaces, short arrays, `??`, typed properties, `match`, enums, typed class constants and the rest, PHP 5.3 to 8.3) by the php.net page that introduces it, cited in the rule: the version's migration guide from 5.6 on, the PHP 5 changelog for 5.3 to 5.5, whose guides php.net no longer hosts. The floor is syntax only: functions, extensions and configuration play no part, so it is a lower bound. Two things date nothing: what the parser's error recovery made of code it cannot parse (a PHP 5 `$s{0}` offset), and an attribute alone on its line, which PHP before 8.0 reads as a `#` comment. The lang-kit contract gains the `versionFloor` fact kind (`VersionFloorFact`, `compareLanguageVersions`); the profile's optional `ecosystem.php.versionFloors` holds `floors`, `none` and `highest`. A repository whose PHP has no dated syntax still gets the counts, with no `highest`, so an all-PHP-5 repository is not mistaken for one the pack never read. A repository without PHP files or without the PHP pack writes the same files as before.

- [#1065](https://github.com/en-dash-consulting/n-dx/pull/1065) [`1dc0110`](https://github.com/en-dash-consulting/n-dx/commit/1dc01107170e5152c4874798bacd765fa490b8f8) Thanks [@endash-shal](https://github.com/endash-shal)! - Internal: refactor llm-client and the language packs without changing behaviour: shared HTTP retry and child-process settling, one merged project-config loader, vendor failover as a table, and shared span helpers in the packs.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`d4d2866`](https://github.com/en-dash-consulting/n-dx/commit/d4d28664500af935874abbc49084703d7e28871f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `sv analyze` no longer follows a symlinked directory when it looks for sub-analyses, so `--deep` never analyzes or writes outside the project.
  
  Action needed: a symlinked directory is no longer promoted as a sub-analysis. Analyze its target on its own with `sv analyze <target>`.
  
  Before, a link such as `vendor-link -> ../other-project` pulled that project's zones and file paths into this project's `zones.json` and `CONTEXT.md`, and `--deep` ran analyze inside it. Two links back to their own directory made the search branch without end, and analyze hung in the zones phase. A sub-analysis whose `.sourcevision/` resolves outside the project is now also refused.
  
  The IaC, API-contract, `go.mod` and Java package-root scans now read regular files only, as the inventory does, so a symlinked file is never read.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`a4f0ab9`](https://github.com/en-dash-consulting/n-dx/commit/a4f0ab91e1c6a69c86a296edb0e26bd831126f76) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `sv analyze` now reports language-pack files that do not parse cleanly, in one `[<pack>-parse]` line and in `imports.json` `summary.parseIssues`.
  
  The report counts files with syntax errors, files over the parser's 1 MiB limit, unreadable files and files that are not valid UTF-8, with up to 50 sorted example paths for each. It covers every pack the imports phase runs (PHP, Java, Go, Python). Nothing becomes fatal: facts are still read from a file with syntax errors, and a non-UTF-8 file is still parsed. When every file parses cleanly the field is absent and `imports.json` is unchanged. The field names are new and under review.

- [#1051](https://github.com/en-dash-consulting/n-dx/pull/1051) [`5e253e4`](https://github.com/en-dash-consulting/n-dx/commit/5e253e4a8e2043ddf5082703e307850f29e1a2ec) Thanks [@ryrykeith](https://github.com/ryrykeith)! - `sv analyze` now removes a URL password that holds `/`, `?` or `#`. Before this, a URL such as `mysql://app:pa/ss@db/app` was written whole, password included. Generated passwords often hold `/`.
  
  The PHP pack's outbound targets follow the same rule. Before this, a password holding `@` or `#` could leave part of itself in the target. A base64 value ending in `=` padding (`abcKey==`) is no longer turned into `abcKey=REDACTED`.

## 0.10.4

No changes in this release.

## 0.10.3

### Patch Changes

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`55d304a`](https://github.com/en-dash-consulting/n-dx/commit/55d304a06b9e7547490a64e91888a9c25ac64621) Thanks [@endash-shal](https://github.com/endash-shal)! - Resolve Java inherited member types, method references and visible wildcard imports; recognize interface entry points and additional JDK packages. Match Gradle type-safe project accessors to declared projects. Preserve Go workspace import resolution for oversized generated files and report discovery failures even when no build file was found. Reuse verified extracted grammar toolchains without keeping duplicate archives.

- [#909](https://github.com/en-dash-consulting/n-dx/pull/909) [`c01c1cf`](https://github.com/en-dash-consulting/n-dx/commit/c01c1cfdd02e8140e19816cdc7532a14536b691d) Thanks [@endash-shal](https://github.com/endash-shal)! - Use the shared Go module parser in Rex, and honor workspace replacement precedence against the originally required version.

## 0.10.2

### Patch Changes

- [#891](https://github.com/en-dash-consulting/n-dx/pull/891) [`19816b7`](https://github.com/en-dash-consulting/n-dx/commit/19816b719a347f36cb8c96831089836cc62584f7) Thanks [@endash-shal](https://github.com/endash-shal)! - Correct outbound and workspace connection evidence: respect JavaScript scopes, retain configured HTTP paths, ignore Go documentation strings and SQL/cache payloads, and withhold ambiguous endpoints or repository-local infrastructure identities. Preserve YAML script bodies and nested flow collections, record executable coverage configuration, and recognize explicitly manual deployment jobs.

## 0.10.1

No changes in this release.

## 0.10.0

### Patch Changes

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`fe61362`](https://github.com/en-dash-consulting/n-dx/commit/fe613620a2f05fd1ae1d10008ad054d865850ac2) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Gradle build reader continues a Groovy statement past a line that ends in a comma or a binary operator, as Groovy does. `implementation group: 'g',` followed by `name: 'a', version: '1'` on the next line is read as one dependency instead of a "computed group or name" notice, and the second coordinate of `implementation 'a:b:1',` followed by `'c:d:2'` is no longer dropped.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`ae7a6cf`](https://github.com/en-dash-consulting/n-dx/commit/ae7a6cfea0ecb476b8ff3df58dc2e7c9cec323f4) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java build file readers no longer take seconds or longer on a tag with no closing tag followed by long whitespace, an unterminated `<!--`, unclosed `<plugins>`/`<parent>`/`<modules>` blocks or an unterminated `/*` in a Gradle script. An unterminated XML comment now runs to the end of the file. A `pom.xml` or Gradle script over 1 MiB is skipped with a notice.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`f0547c4`](https://github.com/en-dash-consulting/n-dx/commit/f0547c402f756734ecf85a26365141d6bc806d03) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Java's `target/`, `build/`, `out/` and `generated/` are skipped only as build output: at the project root or beside `pom.xml`, `build.gradle` or `build.gradle.kts`, never below `src/`. A Java package with one of those names (Spring's `org.springframework.aop.target`) is now in the inventory. Repositories without Java are unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`02fb706`](https://github.com/en-dash-consulting/n-dx/commit/02fb706ebe718b2feb133cd5c1c9134bcaf24676) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Java resolver links a test file to another module's test code only when the build lets javac do so: a Maven dependency of type `test-jar` or classifier `tests` on that module, a Gradle `testFixtures(project(':x'))` (its `testFixtures` set) or a project dependency on a test configuration such as `testArtifacts` (its `test` set). Otherwise a test in `svc-a` that names a class declared only in `svc-b/src/test` gets no edge to it, and a name declared in `svc-b/src/test` and `svc-c/src/main` resolves to the main declaration alone. Main code never links to test code. Build files that cannot be read lose only these links: every other Java import still resolves, and the analysis records a notice naming the failure. lang-kit's Gradle build model gains `projects`, the module's dependencies on other projects of the build.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`1c9ca5e`](https://github.com/en-dash-consulting/n-dx/commit/1c9ca5e4cfcc161657a9958887463b2f8cd37a2a) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Move language ids and configs, detection, the Go/Maven/Gradle build-file readers and the TOML/XML/YAML parsers from sourcevision into `@n-dx/lang-kit`. lang-kit's detection takes the config override and the Terraform search as arguments; sourcevision supplies both. Analysis output is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`f47ebc5`](https://github.com/en-dash-consulting/n-dx/commit/f47ebc52247e319e1f61e6a77b13701da2c06a8e) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Define the facts-out pack contract in `@n-dx/lang-kit`: per-file `FileFacts` with imports, symbols and calls produced today and routes, components, outbound calls and resources declared for later packs. sourcevision's Java, Go and SQL packs fill it through a new adapter, and the Java and Go import graph is built from the imports facts. Analysis output is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`9ff58a3`](https://github.com/en-dash-consulting/n-dx/commit/9ff58a316861865c0cfe0237b95cbca755375f74) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Add `@n-dx/lang-kit`, a foundation-tier package for language facts and the pack contract; sourcevision depends on it.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`380dd67`](https://github.com/en-dash-consulting/n-dx/commit/380dd67fce4a3a4dea57b06681fc9ad3842e0e2f) Thanks [@ryrykeith](https://github.com/ryrykeith)! - Java and Go analysis now comes from the `@n-dx/lang-java` and `@n-dx/lang-go` packs, which sourcevision loads at run time: first from the per-user pack directory (`<ndx home>/packs/<sourcevision version>/`), then from the normal install. A pack must match sourcevision's version. Without the Java pack, Java files get inventory only and one notice names the install command (`npm install --prefix <pack dir> @n-dx/lang-java@<version>`); without the Go pack, Go imports come from the regex parser. `@n-dx/lang-kit` adds the pack entry type (`LanguagePackEntry`) and the embedded-SQL table reader.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`ec5f864`](https://github.com/en-dash-consulting/n-dx/commit/ec5f86406c203d43858144c24e0b8f73a96b64f5) Thanks [@ryrykeith](https://github.com/ryrykeith)! - lang-kit reads Python project metadata as text: `pyproject.toml` (PEP 621, dependency groups, Poetry, setuptools, hatch, uv workspace), `setup.cfg`, requirements files with `-r`/`-c` includes, and the literal arguments of `setup.py`'s `setup(...)`, which is never executed. Each project gives its name, source roots, listed packages and PEP 503-named dependencies with file and line; malformed input becomes a notice. The TOML reader now accepts arrays of tables, multi-line strings and digit separators. Nothing in sourcevision uses the readers yet, so analysis output is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`1bb77bf`](https://github.com/en-dash-consulting/n-dx/commit/1bb77bf3a8e6935295bcc59686fe79990f7a2a73) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Python pack resolves imports: absolute, from-import submodule or attribute, relative, src-layout and namespace-package imports become edges to project files across each project's source roots, so Python files join the import graph and zones, beside TypeScript in a mixed repository. Externals are named `python:<top-level module>`, so npm and PyPI packages of the same name stay apart; stdlib is `python:stdlib:<module>` from a pinned Python 3.13 list, and a third-party module is matched to a declared dependency by PEP 503 name only. A target imported only under `TYPE_CHECKING` is a `type` edge. Without the pack every artifact is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`bf141e2`](https://github.com/en-dash-consulting/n-dx/commit/bf141e29a91a42da1b2b6c184c291650f088ef92) Thanks [@ryrykeith](https://github.com/ryrykeith)! - The Python pack reads structure: the pinned tree-sitter-python 0.25.0 grammar, imports as written (relative dots kept, `TYPE_CHECKING` and `ImportError`-guarded imports marked, `from __future__` skipped), classes, functions, methods, decorators, module-level names and literal `__all__`, and calls; dynamic imports are counted in its notices. `ndx sv pack add python` installs it. Its imports are not resolved yet, so Python files still get no edges, and without the pack every artifact is unchanged.

- [#760](https://github.com/en-dash-consulting/n-dx/pull/760) [`f901248`](https://github.com/en-dash-consulting/n-dx/commit/f9012480fce7578a73592eeddc371f472026fed6) Thanks [@ryrykeith](https://github.com/ryrykeith)! - A Python project's `env`, `build` or `dist` directory is now skipped only when it is not a package: one holding `__init__.py` (poetry's `src/poetry/utils/env/`) is inventoried, while virtualenvs and build output are still skipped. This changes `inventory.json` for Python projects with such packages, whether or not the Python pack is installed; other projects are unchanged.

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
