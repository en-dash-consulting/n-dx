---
id: "94b212f6-fac0-4adb-8a12-814d38e792f9"
type: "task"
title: "Add the php language config to lang-kit"
slug: "add-the-php-language-config-to-lang-kit"
summary: "Teach n-dx's language detection that PHP is a language of its own, with its file types, test files and project markers, so PHP repositories stop being analysed as TypeScript."
description: "Add `packages/lang-kit/src/php.ts` exporting `phpConfig: LanguageConfig`, modelled on `python.ts`, and register it wherever the other configs are registered (registry, detection, index exports).\n\n- id `php`, displayName `PHP`.\n- Extensions: `.php`, `.phtml`, `.php3`, `.php4`, `.php5`, `.inc`, `.module`, `.install`. `.inc`, `.module` and `.install` are ambiguous outside PHP (Pascal, Drupal, others): count them as PHP only in a repository detected as PHP, and say so in the config's doc comment.\n- `parseableExtensions`: `.php`, `.phtml`, `.php3`, `.php4`, `.php5`, `.inc` — parseable only by the opt-in `@n-dx/lang-php` pack, which does not exist yet; without it PHP files are inventoried and classified only (same pattern as Python before its pack).\n- Markers: `composer.json`, plus `index.php` or another `*.php` file at the repository root when no other language's marker wins.\n- Test patterns: `tests/` and `test/` directories, `*Test.php`, `*_test.php`, `phpunit.xml`, `phpunit.xml.dist`.\n- Skip directories: `vendor/` only when a `composer.json` sits beside it (legacy repositories often commit hand-copied libraries under `vendor/` without Composer, and those are source to inventory); `.phpunit.cache/`, `cache/` and `tmp/` only when they hold no `.php` source. Follow Python's \"skipped only when not a package\" approach for the conditional cases.\n- Config filenames: `composer.json`, `composer.lock`, `php.ini`, `.htaccess`, `phpunit.xml`, `phpunit.xml.dist`.\n- Entry points: `index.php`, `public/index.php`, `web/index.php`, `htdocs/index.php`.\n- Remove `.php` from `FALLBACK_LANGUAGE_EXTENSIONS` in `packages/lang-kit/src/detect.ts`, so a PHP repository no longer falls back to the TypeScript config.\n- Make sure sourcevision's inventory labels these files PHP (packages/sourcevision/src/analyzers/inventory.ts) and that any list of supported languages derived from the registry (for example the web Settings › Project language list from #1047) picks PHP up without a hand-maintained list falling out of step; update that list's test if it enumerates languages.\n\nTests: detection on a PHP-only fixture, a Composer fixture, a mixed TS + PHP fixture (TS stays primary where its markers win), `.inc` in a non-PHP repository not counted as PHP, and `vendor/` with and without `composer.json`."
acceptanceCriteria:
  - "A PHP-only repository and a Composer repository are detected as php"
  - "A TypeScript repository containing a few .php files keeps its current detection"
  - ".inc, .module and .install count as PHP only in a PHP repository"
  - "Analyze output for every existing non-PHP fixture is byte-identical"
priority: "high"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "php"
  - "lang-kit"
---
