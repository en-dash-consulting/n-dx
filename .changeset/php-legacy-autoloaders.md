---
"@n-dx/lang-php": patch
---

With the PHP pack, old-style class names such as `Mail_Mime` now link to the files that declare them in PHP code without Composer. The pack follows the PEAR naming convention (`Mail_Mime` is `Mail/Mime.php`) through the include path. It also applies hand-written `__autoload` functions and `spl_autoload_register` callbacks whose paths are built from literals and the class name. When a class is declared in more than one file, these rules pick the file PHP would load. If none applies, the reference stays unresolved. An autoloader the pack cannot follow is reported with its file and line.
