---
id: "d4da1efe-89b4-4d06-ad10-382baa25d3a2"
type: "task"
title: "No test pins the parenthesised array base, write target or method receiver in PHP database flow"
slug: "no-test-pins-the-parenthesised-array"
summary: "The fix for brackets around a variable in the PHP database report is only tested for object properties. Add tests for the array, write and method-call forms so a later change cannot quietly break them."
description: "Found by the adversarial review of bb53b4af2 (task 03468932). Verdict: should-fix, severity low.\n\nScenario: `FlowCompiler.variableIn` (packages/lang-php/src/php-database-flow.ts) is used at four sites: the member object and the subscript base in `readPathOf`, the copy source in `target`, and `receiverName` in `methodCall`. The committed fixture (tests/fixtures/php-database-flow/properties.php, `parenthesised_sibling`, `parenthesised_copy`) exercises only the member object and the copy source. Reverting `this.variableIn(base)` to `variable(base)` in the subscript branch, or `this.variableIn(object)` to `variable(object)` in `methodCall`, leaves every test green.\n\nEvidence: a throwaway probe during the review confirmed the behaviour is correct today: `call_user_func(($a)['handler'])` and `((($a)))['handler']` unmarked beside a database-fed `$a['body']`; `eval(($a)['body'])` marked; writes through `($x)->body = $row['body']; ($x)->handler = 'trim';` keep per-property sources; `$y = ($row); call_user_func($y['body'])` and `$z = ($row['body']); eval($z)` stay marked. So there is no defect, only unpinned behaviour.\n\nReachability: any PHP file analysed with the pack and `dynamicCode`.\n\nFix (recommended): add those cases to properties.php and the expectations in tests/integration/php-database-flow.test.ts (the `[php-db-exec]`/`[php-db-dispatch]` notice counts move with them). Cost: a few fixture lines. For the receiver, pick a case only `receiverName` decides (`($this)->method()` resolving through the class summary, or a client method on `($db)` that the `sql` query does not read), since `($db)->query('SELECT …')` is already marked through the statement lookup."
acceptanceCriteria:
  - "A fixture case with a parenthesised array base (`($a)['handler']` beside a database-fed `$a['body']`) is expected unmarked, and fails when the subscript branch of readPathOf stops unwrapping parentheses"
  - "A fixture case writing through `($x)->p = …` is expected to keep per-property sources"
  - "A fixture case whose marking depends on a parenthesised method receiver fails when methodCall stops unwrapping parentheses"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "lang-php"
  - "database-flow"
source: "ndx-adversarial-review"
---
