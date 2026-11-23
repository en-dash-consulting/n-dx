---
id: "d1227eb0-8e09-425b-b818-f244879e61e9"
type: "change"
title: "PHP dynamic-code rules read a named argument by position, so array_filter(callback: 'trim', array: $items) is a false dispatch site"
slug: "php-dynamic-code-rules-read-a-named"
summary: "The PHP dynamic-code report finds a callback by its position in the call, so PHP 8 calls that name their arguments out of order can be counted as dynamic when they are not, or the real callback can be missed."
intent: "Verdict: should-fix (ndx-adversarial-review of task 3ce7b963, run 44aa5c9a). Severity low: PHP 8 named arguments are rare in the legacy estates this rule targets.\n\nFailure: `packages/lang-php/src/php-dynamic-code.ts` `namedCallSite` takes the callable as `args[index]` (CALLERS index 0, CALLBACK_ARGUMENT table), and `FileCaptures.argumentValues` returns arguments in written order. `array_filter(callback: 'trim', array: $items)` therefore checks `$items` (a variable) and reports a `dispatch array_filter` site; `array_map(array: $a, callback: 'trim')` likewise. The same positional read applies to eval/assert/preg_replace/create_function arguments (`preg_replace(subject: $s, pattern: '/x/e', replacement: $r)` misreads the pattern). Reproduced with the built pack on a scratch file.\n\nReachable: `sv analyze` with the PHP pack over any PHP 8 file using named arguments on these functions.\n\nOptions: (1) recommended — capture the argument's `name:` field in `queries/php-dynamic/dynamic.scm` and, when any argument of the call is named, look the callable up by its PHP parameter name (`callback`, `pattern`, `replacement`, `code`, `assertion`, …) from a small per-function table; positional arguments before the first named one keep their index. Cost: a table and a test. (2) skip calls that use named arguments entirely: cheaper, but drops real sites."
acceptanceCriteria:
  - "array_filter(callback: 'trim', array: $items) and array_map(array: $a, callback: 'trim') are not reported as dispatch sites"
  - "array_filter(array: $a, callback: $f) is still reported as a dispatch site"
  - "preg_replace(subject: $s, pattern: '/x/e', replacement: $r) is reported as an exec site"
  - "A lang-php integration test with a named-argument fixture covers the three cases above"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "low"
discoveredFrom: {"item":"3ce7b963-e6e2-4593-a830-8cf46fcce425","run":"44aa5c9a-e4e4-4ff4-9d7b-a67bfd728fdf"}
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "php"
  - "lang-php"
source: "ndx-adversarial-review"
---
