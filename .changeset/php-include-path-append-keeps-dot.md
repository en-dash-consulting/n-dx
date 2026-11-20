---
"@n-dx/lang-php": patch
---

With the PHP pack, a `set_include_path(get_include_path() . …)` anywhere in a repository no longer drops include edges that rely on PHP's default `.` root.

`get_include_path()` in a setting now stands for the include path in force for the including file: its `.user.ini`, `.htaccess` and `php.ini` roots, or PHP's default `.` when none is configured. A setting that replaces the path outright still searches only its own roots. Settings still apply to every file, because which entry script runs them is unknown.
