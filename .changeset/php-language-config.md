---
"@n-dx/lang-kit": patch
"@n-dx/sourcevision": patch
"@n-dx/core": patch
"@n-dx/web": patch
---

`ndx analyze` now detects PHP repositories as PHP instead of analysing them as TypeScript, and `php` is a valid `language` setting in `ndx config` and on Settings › Project.

A repository is PHP when it has a root `composer.json` (weighed by source count against other markers, as for any language), or, with no other marker, a `.php` file at its root. A TypeScript repository with a few PHP files keeps its detection. PHP files are inventoried and classified only; no PHP pack exists yet, so imports, zones and every other artifact are unchanged for them.

`.inc`, `.module` and `.install` count as PHP only in a PHP repository. There, `vendor/` is skipped only beside a `composer.json`, so hand-copied libraries in a legacy `vendor/` are inventoried, and `cache/`, `tmp/` and `.phpunit.cache/` are skipped unless they directly hold a `.php` file. `.phtml`, `.php3`, `.php4` and `.php5` files are labelled PHP in every repository.
