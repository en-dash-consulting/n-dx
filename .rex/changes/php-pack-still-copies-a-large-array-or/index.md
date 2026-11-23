---
id: "d6e820c7-3ac2-4351-8803-b88f6ba9b833"
type: "change"
title: "PHP pack still copies a large array or closure nested in a path-shaped assignment"
slug: "php-pack-still-copies-a-large-array-or"
summary: "The PHP pack still keeps two extra copies of a large configuration array when the array is passed through a function call or joined with another value. Narrowing that capture finishes the memory fix for large legacy codebases."
intent: "Found by the adversarial review of task f3198e15 (run 58509c0c). Verdict: should-fix, medium.\n\nScenario: `$config = array_merge($defaults, array(/* 5000 lines */));` or `$x = $a + array(...)` or `$cb = call_user_func(function () { /* long */ });`. The right-hand side is a function_call_expression or binary_expression, both on the allow-list in packages/lang-php/queries/php/imports.scm:69-83. So @include.assign_value (the right-hand side) and @include.assign (the whole assignment) both carry the full text. lang-runtime's runner copies node.text eagerly (packages/lang-runtime/src/runner.ts:168), and preparePhpImports holds every file's captures at once. The memory the task meant to save is still spent on this common legacy configuration pattern.\n\nReachable: any PHP project analyzed with the pack; only php-autoloaders.ts reads these captures, and it evaluates only literals, `.`, constants, variables and the calls dirname, str_replace, strtr, strtolower, strtoupper, trim/ltrim/rtrim and get_include_path (php-includes.ts `call`).\n\nOptions:\n1. Recommended. Restrict function_call_expression with a `#match?` on its function name to the calls the evaluator understands. Keep any call the host-variable task (62d00b31) needs; strtolower is already on the list. Cheap; the risk is forgetting to extend the predicate when the evaluator learns a new call, so add a test that checks the two lists agree.\n2. Stop capturing @include.assign text: key ownership by span instead. This needs a runner option to skip node text; a larger change in lang-runtime.\n3. Cap the captured text length (a value longer than N characters is treated as unknown). Simple, but arbitrary.\n\nOut of reach of a query predicate: a binary_expression whose operand is a huge array; option 2 or 3 covers that."
acceptanceCriteria:
  - "An assignment whose right-hand side is a call to a function the include evaluator does not understand (array_merge with an array literal argument) produces no include.assign_value capture, shown in the php golden"
  - "A test fails when the evaluator's list of understood calls and the query's function-name predicate disagree"
  - "The php-legacy-autoload, php-legacy-includes and dynamic-include integration tests pass unchanged"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"f3198e15-a42e-4e05-9917-a6be8ff68d36","run":"58509c0c-bc63-4549-a109-acad9eb3fc88"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-php"
source: "ndx-adversarial-review"
---
