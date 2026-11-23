---
"@n-dx/lang-php": patch
---

With the PHP pack, `include` and `require` statements whose path is built from literals now become import edges: plain strings, `__DIR__`, `dirname(__FILE__)` and repository constants such as `ROOT`. Paths are looked up the way PHP does, using the include path set by `set_include_path`, `ini_set`, `php.ini`, `.user.ini` and `.htaccess`. A relative path is also tried against each directory above the including file that holds an `index.php`, so apps with several entry scripts, such as osCommerce's `catalog/` and `catalog/admin/`, resolve their includes. Include-path entries outside the repository are reported and ignored. Includes built from variables still give no edge.
