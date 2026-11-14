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

Nothing yet: `phpPack` has no queries and `produces` is empty, so sourcevision degrades PHP with `the pack does not produce "imports"` and PHP files keep inventory only.

### Scripts

`build:grammars` builds the grammar into `build/grammars` (CI and release run it before tests and publish); the grammar tests skip without it unless `SV_REQUIRE_GRAMMARS=1`.
