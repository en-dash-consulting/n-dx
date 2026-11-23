---
"@n-dx/lang-php": patch
"@n-dx/lang-kit": patch
---

`ndx analyze` with the PHP pack no longer stalls on unusual lines in the repository being analysed.

Eleven text patterns that slowed down sharply on long lines are now linear scans. They read `.htaccess` directives, `include_path` settings in `.htaccess`, `php.ini` and `.user.ini`, database connection strings, `PHP_SAPI` checks, trailing slashes in Composer and include paths, and feature-flag names. Results are unchanged. A `.htaccess`, `php.ini` or `.user.ini` line longer than 64 KiB is now skipped and counted in a notice instead of being read.
