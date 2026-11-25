---
"@n-dx/lang-kit": patch
---

`sv analyze` skips `node_modules/` and `dist/` in a PHP repository and labels minified JavaScript such as `js/jquery.min.js` as generated.

Before, a repository detected as PHP alone walked a theme's `node_modules/` and `dist/` as source, and `*.min.js` and `*.bundle.js` files were listed as source. The PHP language config now uses the TypeScript config's skipped folders, except `build/`, and its generated-file patterns. `build/` stays source: PHP sites copy libraries into it, and Python and Java keep their own rules for it. PHP's own conditional skips are unchanged: `vendor/` only beside `composer.json`, and `cache/`, `tmp/` and `.phpunit.cache/` only when they hold no `.php` file.
