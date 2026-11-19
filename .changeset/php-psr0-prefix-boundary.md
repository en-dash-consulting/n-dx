---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack no longer counts a library as part of the project when its namespace merely starts with a project PSR-0 prefix.

With `"psr-0": {"Acme": "src/"}` (the Monolog 1.x and Guzzle 3 style), `use AcmeCorp\Sdk\Client` was treated as the project's own missing class and left out of the externals. A PSR-0 prefix without a trailing `\` or `_` now covers a name only up to a `\` or `_`, so that import is an external again. The same rule applies to `composer.lock` package prefixes. A class file found at the PSR-0 path still resolves as before.
