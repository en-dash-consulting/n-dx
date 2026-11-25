## lang-php

`@n-dx/lang-php` is the PHP pack: the pinned tree-sitter-php grammar and the pack definition. It is opt-in (`ndx sv pack add php`): without it, PHP files get inventory only and every analyze artifact is unchanged.

### Rules

- **Imports only `@n-dx/lang-kit` and `@n-dx/lang-runtime` from n-dx.** No pack imports another pack.
- **Loaded, never imported.** sourcevision finds this package at run time (`src/language/pack-loader.ts`: the per-user pack directory, then module resolution) and imports it dynamically; nothing in a package's `src` imports it statically. Its version must equal sourcevision's, or sourcevision refuses it.
- **Returns facts.** `pack` (`src/pack.ts`) is a lang-kit `LanguagePackEntry` built with lang-runtime's `createPackEntry`, and it is the only export sourcevision reads; no tree-sitter type crosses into sourcevision.
- **Finds its assets from its own root** (`src/package-paths.ts`): the grammar in `build/grammars`, queries in `queries/php`.
- **No PHP toolchain.** Grammars ship prebuilt as WASM; nothing here, in its tests or in its scripts may require a PHP interpreter, Composer or any PHP tool. PHP versions and syntax rules come from cited sources, never from memory.

### Grammar

`tree-sitter-php` 0.25.1, built from the release archive's `php/` grammar (PHP mixed with HTML, so `<?php … ?>` blocks between markup parse), not `php_only/`. The pin and its `subdir` live in `packages/lang-runtime/scripts/build-grammars.mjs`; `phpPack.grammar.version` must match it (`tests/unit/php-grammar-pin.test.ts`).

### What it reads

`produces` is `imports`, `symbols` and `calls` (not in `callgraph.json`, which is JS/TS only), from `queries/php/` (provenance per rule in `src/php-pack.ts`), and from frameworks (rules in `src/<id>.ts`, query in `queries/<id>/`) `routes` (`php-docroot`), `entryPoints` (`php-entry`, `src/php-entry-points.ts`), `outboundCalls` (`php-outbound`), `configReads` and `flagChecks` (`php-config`, never a value; fixture `tests/fixtures/php-config/`), `versionFloor` (`php-compat`), `legacyConstructs` (`php-legacy`), `dynamicCode` (`php-dynamic`, `src/php-dynamic-code.ts`). Inline HTML is never captured. Drupal's `.module`/`.install` are parsed too.

- **Imports as written** (`src/php-imports.ts`): `FileReferences.written`, each with its `form` (the four include forms, `use`, `use function`, `use const`). An include's specifier is its path expression as written, quotes included (the parentheses of `require_once("x")` dropped); a `use` gives the qualified name (a group use's prefix joined to each entry) and any `alias`. An include inside a branch, `switch`, loop, function or method body, a short-circuit right operand, `?:` or `match` carries the `conditional` guard (`guards.scm`).
- **Includes** (`src/php-includes.ts`): a path computable from literals, `__DIR__`, `__FILE__`, `dirname()`, `DIRECTORY_SEPARATOR` and constants defined once resolves to a pack file (symbol `*`) by PHP's include search order and include-path roots; anything else gives no edge. Fixture: `tests/fixtures/php-legacy-includes/`.
- **Dynamic includes**: no edge; a `[php-dynamic-include]` or `[php-host-include]` notice (`src/php-include-notices.ts`) and at most `MAX_INCLUDE_CANDIDATES` (50) `WrittenImport.candidates`, never edges (`packages/sourcevision/tests/integration/php-pack-imports.test.ts`). Fixture: `tests/fixtures/php-dynamic-includes/`.
- **Resolution** (`src/php-resolver.ts`, `src/php-autoloaders.ts`): `use` imports and class references, qualified as PHP does, resolve through Composer autoload (lang-kit's `readComposerProjects`), legacy autoloaders, then a class declared in exactly one file. Unresolved per D5: builtins (`src/php-builtins.ts`) are nothing, `composer.lock` packages external, the project's own names unresolved, others `php:<first namespace segment>`. Symbols are qualified names. `preparePhpImports(...).outcomes(path)` feeds `packages/sourcevision/scripts/php-resolve-report.mjs`. Fixtures: `tests/fixtures/php-composer/`, `php-legacy-autoload/`.
- **Symbols** (`src/php-symbols.ts`): class, interface, trait, enum, function, method, namespace (not a container) and constant (`const` elements, class constants, `define()` with a literal name). `__construct`, and a method named as its class in a class outside any namespace with no `__construct`, are constructors; functions and `define()` constants are never members.
- **Routes** (`src/php-docroot.ts`): docroots are `phpDocroots` (`src/php-docroots.ts`: each directory `isDocrootName` accepts — a `PHP_DOCROOT_DIRECTORIES` name, `httpdocs` or a prefixed `*_htdocs` — holding `index.php`, any depth, not nested; else a root `index.php`; none is a notice). Each `.php`/`.phtml` file under one is a `GET` and `POST` route at its docroot-relative URL, `source` `docroot <dir>`, except `*.inc.php`, declaration-only fragments (top-level statements from `docroot.scm`) and files `.htaccess` denies (`src/php-htaccess.ts`: nearest `Deny from all`/`Require all denied` vs grant per directory, `<Files>`/`<FilesMatch>` denials, `RedirectMatch 403`). A `RewriteRule` to a literal `.php` target (not `R`/`F`/`G`/`P`; relative under `RewriteBase`) or `FallbackResource` is a catch-all route on its target, the pattern as written (`<dir URL>*` for `FallbackResource`), `source` `<.htaccess>:<line>`; a missing target is a notice. `.htaccess` text reaches the framework as the resolver's `configFiles`. Fixtures: `tests/fixtures/php-docroot-{flat,drupal7,public}/`.
- **Entry points** (`src/php-entry-points.ts`, `src/php-cron.ts`): `cli` scripts (shebang, `PHP_SAPI` check, `$argv`) and the scripts crontabs run.
- **Outbound calls** (`src/php-outbound.ts`, rules in its module comment): HTTP, SOAP, database, cache and environment reads, all `certain`.
- **Legacy constructs** (`src/php-legacy.ts`): uses of what later PHP versions removed or deprecated, every version with its php.net page; `<?` and string-to-number `==` are notices, never removals.
- **Legacy syntax** (`src/php-legacy-syntax.ts`): a file that parses with errors has its `$s{0}` offsets rewritten to `$s[0]` (same length) and is parsed again; a clean reparse is `parse.legacySyntax`, not a syntax error, and each rewrite counts once as `curly-offset`. `<?` and `each()` parse as written.
- **Dynamic code** (`src/php-dynamic-code.ts`): `exec` (`eval`, string `assert`, `/e` `preg_replace`, `create_function`; `literal` when the code is literals alone), `dispatch` (a callable or name chosen by a value) and `include` (`isDynamicIncludePath`, counted, never noticed again) sites, each with `construct`, expression as written, `scope` and the `notice` code that counts it; an include site copies its written include's candidates and total. Notices `[php-dynamic-exec]`, `[php-dynamic-dispatch]`. Fixture: `tests/fixtures/php-dynamic-code/`. A site fed by a query result gets `database` (tables, columns, sources; rules in `src/php-database-flow.ts`), noticed as `[php-db-exec]`/`[php-db-dispatch]`. Fixture: `tests/fixtures/php-database-flow/`.
- **Embedded SQL** (`src/php-sql.ts`, `queries/php/sql.scm`): `extractPhpEmbeddedSql`, in memory only, as Java's and Go's.
- **Calls**: function, method, nullsafe and static calls with the receiver or scope as written, and `new` (`construct: true`, the class as callee), with or without an argument list.

Rules in detail (include search order, dynamic-include candidates, resolution order and D5, and every framework rule): [PHP pack rules](../../docs/packages/sourcevision.md#php-pack-rules).

Goldens: `tests/fixtures/language-packs/php/` (`php52/`, `php53/`, `php8/`), updated with `test:update-goldens`.

### Scripts

`scripts/php-parse-errors.mjs <file>…` prints where the grammar fails on a file (positions and node types, never its text), after the legacy-syntax rewrite. `build:grammars` builds the grammar into `build/grammars` (CI and release run it first); grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`.
