---
id: "cd616ada-a02b-450d-986d-3bad122ec522"
type: "task"
title: "P10: leave files behind a direct-access guard out of docroot routes"
slug: "p10-leave-files-behind-a-direct-access"
summary: "Stops library files that refuse to run on their own from being listed as web pages."
description: "#1082 review P10 (medium), `packages/lang-php/src/php-docroot.ts` `isFragment` and `php-htaccess.ts`.\n\nTrigger: files guarded by `defined('BASEPATH') OR exit;`, `defined('_JEXEC') or die;` or `if (!defined('ABSPATH')) exit;` and then declaring classes are each listed as a GET/POST route. Joomla and WordPress plugins have no `.htaccess` denial to save them. `Require ip 127.0.0.1` is not read as a restriction either.\n\nFix: a file whose first top-level statement is a `defined(...)` guard that exits or dies when the constant is missing, followed only by declarations (and the usual `use`/`namespace`/`require` lines), is a fragment. A guarded file that also has top-level statements after the guard stays a route. Read `Require ip` / `Require host` (with no `Require all granted`) as a restriction in `.htaccess`, and say in the route's `source` or a notice that it is restricted rather than dropping it, if dropping would be wrong; choose and say why.\n\nTests (invented docroot fixture): each of the three guard forms followed by a class is not a route; a guarded page with output is a route; `Require ip` handling as chosen."
acceptanceCriteria:
  - "Guarded declaration-only files are not routes"
  - "Guarded files with top-level statements stay routes"
  - "Require ip is handled and the choice is documented"
priority: "medium"
run: {"tier":"standard","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "routes"
---
