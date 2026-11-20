---
id: "09cd6ed9-0ee5-425d-b115-c852b316a558"
type: "task"
title: "Resolve literal PHP includes through the include path"
slug: "resolve-literal-php-includes-through"
summary: "Follow include and require statements whose target can be worked out from the code, the way PHP itself searches for files, so old PHP 5 repositories get a real dependency graph."
description: "In `@n-dx/lang-php`, resolve `include`/`require` (and `_once`) whose path is computable from literals, and add the edges through the existing merge path. Keep the written import's guard (`conditional` where set).\n\nComputable forms:\n- a string literal;\n- `__DIR__ . '/x.php'`, `dirname(__FILE__) . '/x.php'`, `dirname(__DIR__) . '/x.php'`, `dirname(__FILE__, n)` / `dirname(__DIR__, n)`;\n- constants defined in the repository by `define('ROOT', <one of the forms above>)` or `const ROOT = …` with a single literal-computable value, used as `ROOT . '/lib/x.php'` (a constant defined more than once with different values is not computable);\n- concatenation of the above.\n\nSearch order, following PHP: a path starting with `/`, `./` or `../` is resolved relative to the including file's directory (PHP resolves `./` against the working directory; use the including file's directory and the detected docroot as the two candidates, preferring an existing file in that order). A bare relative path is searched in the include-path roots, then the including file's directory.\n\nInclude-path roots come from literal `set_include_path(...)` and `ini_set('include_path', ...)` (with `get_include_path()` and `PATH_SEPARATOR` concatenations), `include_path` in any `php.ini` / `.user.ini` in the repository, and `php_value include_path` in `.htaccess`. Paths outside the repository are ignored with a notice.\n\nFixtures: a PHP 5.2-style app with `config.php` defining `ROOT`, nested includes, `set_include_path` with PEAR-style `lib/`, a `.htaccess` include path, and a conditional include."
acceptanceCriteria:
  - "Literal, __DIR__ and dirname(__FILE__) includes and repository constants like ROOT resolve to file edges"
  - "Include-path roots from set_include_path, ini_set, php.ini and .htaccess are used in PHP's search order"
  - "Conditional includes keep the conditional guard on their edges' source facts"
  - "Non-PHP output is byte-identical"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
  - "resolver"
---
