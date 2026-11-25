---
id: "bd91778d-ccce-4732-a205-581368648413"
type: "task"
title: "A `use` line before the direct-access guard keeps a guarded PHP class file as a docroot route"
slug: "a-use-line-before-the-direct-access"
summary: "Some PHP class files put their import lines above the check that blocks direct requests, and those files are still listed as pages. Recognising that order removes them from the page list."
description: "Found by the adversarial review of P10 (cd616ada). Verdict: should-fix, low.\n\nScenario: an invented file\n\n```php\n<?php\nnamespace Acme\\Shop;\nuse Acme\\Shop\\Model\\Cart;\ndefined('_JEXEC') or die;\nclass CartView {}\n```\n\n`isFragment` (`packages/lang-php/src/php-docroot.ts`) only lets `namespace_definition` and `declare_statement` precede the guard (`BEFORE_GUARD`). The `use` line is the first statement, it is not a guard, so the file is a GET/POST route. Requested directly it declares nothing visible and exits at the guard, exactly as when the guard is first. The same holds for any declaration (function, class, const) before the guard.\n\nReachable: `ndx analyze` on a PHP site with such files (seen as a shape in Joomla extensions). Not covered by any test.\n\nFix (recommended): accept any run of `DECLARATIONS` before the guard, i.e. the guard is the first statement that is not a declaration. Cost: one line and a fixture file. Risk: none found; declarations before an exit produce no output."
acceptanceCriteria:
  - "A file with `use` lines before `defined('X') or die;` followed only by declarations is not a route"
  - "A file with a function or class declared before the guard and only declarations after it is not a route"
  - "A file with declarations, a guard, then output stays a route"
  - "The php-docroot-guarded fixture and tests/integration/php-docroot-routes.test.ts cover the use-before-guard file"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-php"
  - "routes"
source: "ndx-adversarial-review"
---
