---
id: "ec5c180b-a937-4585-afe2-b61c8ad83564"
type: "task"
title: "No test pins where get_include_path() roots sit when a php.ini or .htaccess include path is in force"
slug: "no-test-pins-where-get-include-path"
summary: "The PHP include fix changed the search order for sites that configure an include path, and no test checks that order. A later change could silently link a file to the wrong copy when two folders hold the same file name."
description: "Adversarial review of P2 (faa0c3c8, commit 0478fc1a1). Verdict: should-fix, severity medium (test gap; the new order matches PHP).\n\nScenario: `packages/lang-php/src/php-includes.ts` `rootsFor` now expands a setter's `get_include_path()` part in place to the configured roots in force. With `php.ini` `include_path = \".:inc\"` and `set_include_path(get_include_path() . PATH_SEPARATOR . 'lib')`, the roots were [lib, ., inc] before P2 and are [., inc, lib] now. A file present as both `inc/Mail.php` and `lib/Mail.php` now resolves to `inc/Mail.php` (as PHP does); before it resolved to `lib/Mail.php`. Same for `.htaccess`/`.user.ini` roots under their directory.\n\nEvidence: `tests/integration/php-includes.test.ts` over `php-legacy-includes` passes with either order (no file name exists under two roots), and the two new fixtures have no config file. Reverting the in-place expansion for the configured case (appending config roots after setter roots, as before) leaves every test green.\n\nReachable: any repository with a tracked php.ini/.user.ini/.htaccess include path, an appending or prepending setter, and one file name under two roots.\n\nOptions: (1, recommended) an invented fixture with a config include path, a prepending and an appending setter, and a file name under a config root and a setter root; assert each resolves as PHP orders them. Cost: one small fixture and test, no source change. (2) Extend `php-legacy-includes` with a colliding file; cheaper but changes a shared fixture's outcomes."
acceptanceCriteria:
  - "A test with a php.ini include path and set_include_path(get_include_path() . PATH_SEPARATOR . 'lib') resolves a file name present under both a php.ini root and lib to the php.ini root's copy"
  - "A test with set_include_path('lib' . PATH_SEPARATOR . get_include_path()) and the same collision resolves to lib's copy"
  - "Both tests fail if rootsFor appends configured roots after all setter roots instead of expanding get_include_path() in place"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "lang-php"
  - "resolution"
source: "ndx-adversarial-review"
---
