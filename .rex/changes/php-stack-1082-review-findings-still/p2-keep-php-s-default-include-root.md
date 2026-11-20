---
id: "faa0c3c8-a8aa-4762-8e96-227138e9e179"
type: "task"
title: "P2: keep PHP's default . include root when set_include_path appends to get_include_path()"
slug: "p2-keep-php-s-default-include-root"
summary: "Stops one unrelated script that extends PHP's include path from breaking file links across the whole project."
description: "#1082 review P2 (high), `packages/lang-php/src/php-includes.ts` `rootsFor` (adds `.` only when no root exists) and the `get_include_path()` term (`CURRENT_INCLUDE_PATH`).\n\nTrigger: an osCommerce-shaped `catalog/` tree plus an unrelated `tools/pear/setup.php` doing `set_include_path(get_include_path() . PATH_SEPARATOR . 'lib')`. `require 'includes/configure.php'` goes from `catalog/includes/configure.php` to `not-found`, with no notice, so include edges disappear across the repository. The `php-legacy-includes` fixture sets an explicit php.ini include path, so it never exercises this.\n\nCause: setter roots replace the default; but without a php.ini, `get_include_path()` returns PHP's default `.:/usr/share/php`, so `.` stays.\n\nFix: when a setter's value includes the current include path (`get_include_path()`), expand that part to the include path in force for the file (php.ini/.user.ini roots if any, else `.`), so `.` stays. A setter that replaces the path outright (no `get_include_path()`) still drops `.`. Consider whether a setter in one file should apply to unrelated files at all (scope it to files that include, or are included from, the setter's file, if that is cheap); say what you chose.\n\nTests (invented fixture): the trigger above keeps the `catalog/includes/configure.php` edge; a replacing `set_include_path('lib')` still searches only `lib`; the php.ini case is unchanged."
acceptanceCriteria:
  - "An appending set_include_path keeps . for every file"
  - "A replacing set_include_path behaves as today"
  - "The php.ini fixture is unchanged"
priority: "high"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "resolution"
---
