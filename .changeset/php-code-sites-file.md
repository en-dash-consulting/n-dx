---
"@n-dx/sourcevision": patch
"@n-dx/lang-kit": patch
"@n-dx/lang-php": patch
"@n-dx/web": patch
---

With the PHP pack, `sv analyze` now writes `sites.json`: every dynamic and database-fed PHP site, file by file, instead of only the first five locations in a console notice.

Each site has its notice code (`php-dynamic-include`, `php-host-include`, `php-dynamic-exec`, `php-dynamic-dispatch`, `php-db-exec`, `php-db-dispatch`), construct, line and column. An include lists the files it could load: at most 50, with the total and `truncated: true` past that. A database-fed site lists the tables and `table.column` names it reads, never row data or values. The file carries `schemaVersion`, is byte-identical across runs, and is not written (a stale one is removed) when no site is found. The console notices are unchanged.
