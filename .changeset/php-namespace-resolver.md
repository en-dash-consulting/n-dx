---
"@n-dx/lang-php": patch
"@n-dx/sourcevision": patch
---

With the PHP pack installed, `ndx analyze` connects PHP files to each other through Composer's autoload rules, so PHP code joins zones and the import graph.

`use` imports and class references (`extends`, `implements`, trait `use`, `new`, `X::`, type hints, `catch`, `instanceof`) resolve through every `composer.json`'s PSR-4, PSR-0 and classmap autoload, then to a class declared in exactly one file, which also covers repositories without Composer. Names outside the project become `php:<first namespace segment>` externals (`php:Monolog`, or `php:Zend` for `Zend_Db_Table`); PHP's own classes and global functions never do. Includes are still reported as written and not resolved. Without the pack, every artifact is unchanged. `packages/sourcevision/scripts/php-resolve-report.mjs` measures the resolver over the PHP corpus.
