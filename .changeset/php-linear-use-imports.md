---
"@n-dx/lang-php": patch
---

`ndx analyze` with the PHP pack no longer stalls on a PHP file with thousands of `use` statements. Imports read are unchanged.

Each `use` clause, name, alias and group prefix is now matched to its statement in one pass. Before, a file with 2,000 `use` lines took about 90 seconds per read, and each file is read three times.
