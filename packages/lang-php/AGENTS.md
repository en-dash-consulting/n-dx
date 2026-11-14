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

`produces` is `imports`, `symbols` and `calls`, from `queries/php/` (provenance per rule in `src/php-pack.ts`). Inline HTML is never captured.

- **Imports as written** (`src/php-imports.ts`): `FileReferences.written`, each with its `form` (the four include forms, `use`, `use function`, `use const`). An include's specifier is its path expression as written, quotes included (the parentheses of `require_once("x")` dropped); a `use` gives the qualified name (a group use's prefix joined to each entry) and any `alias`. An include inside a branch, `switch`, loop, function or method body, a short-circuit right operand, `?:` or `match` carries the `conditional` guard (`guards.scm`). Includes are never resolved; candidate files for dynamic includes are not filled yet.
- **Resolution** (`src/php-resolver.ts`, class names from `queries/php/references.scm`): `use` imports and class references (`extends`, `implements`, trait `use`, `new`, `X::`, parameter/return/property/`catch` types, `instanceof`) are qualified as PHP does (per-namespace-block `use` aliases; `use function`/`use const` kept apart; `self`/`static`/`parent` dropped) and resolved through every Composer project's `autoload` and `autoload-dev` (lang-kit's `readComposerProjects`, read by `phpResolver.forProject`): PSR-4 longest prefix first, PSR-0, classmap (less `exclude-from-classmap`), then a class declared in exactly one repository file. Unresolved, per D5: PHP's own and common PECL extensions' classes (`src/php-builtins.ts`, by manual book or PECL page), scalar type keywords in any case, and global functions and constants are nothing; a name a `composer.lock` package's autoload prefix covers is external with that package as `module`; a name under the project's own first segment is unresolved; any other is `php:<first namespace segment>` (`php:Zend` for `Zend_Db_Table`). Symbols are qualified names. `preparePhpImports(...).outcomes(path)` says what each reference resolved to, for `packages/sourcevision/scripts/php-resolve-report.mjs`. Fixture: `tests/fixtures/php-composer/`.
- **Symbols** (`src/php-symbols.ts`): class, interface, trait, enum, function, method, namespace (not a container) and constant (`const` elements, class constants, `define()` with a literal name). `__construct`, and a method named as its class in a class outside any namespace with no `__construct`, are constructors; functions and `define()` constants are never members.
- **Calls**: function, method, nullsafe and static calls with the receiver or scope as written, and `new` (`construct: true`, the class as callee), with or without an argument list.

Goldens: `tests/fixtures/language-packs/php/` (`php52/`, `php53/`, `php8/`), updated with `test:update-goldens`.

### Scripts

`build:grammars` builds the grammar into `build/grammars` (CI and release run it before tests and publish); the grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`.
