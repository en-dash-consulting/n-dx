---
id: "9608fc01-9199-4da6-b5de-0c8f1d38e322"
type: "change"
title: "A PHP call written with a space before its parenthesis, such as `foo ($x)` or `$db->query ($sql)`, loses its callee"
slug: "a-php-call-written-with-a-space-before"
summary: "Older PHP code often puts a space between a function name and its parentheses. Those calls are recorded without the name of what was called, so any rule that reads calls misses them."
intent: "Verdict: should-fix (medium). Found by the adversarial review of task 5cd796e9 (PHP structure queries).\n\nScenario: `$r = mysql_query ($sql);` in a PHP file. queries/php/calls.scm captures @call.name \"mysql_query\" and @call.arguments \"($sql)\". callSites in packages/lang-runtime/src/pack-calls.ts pairs a name with a list only when the name ends exactly where the list starts (`namesByEnd.get(key(list.start))`), so with a space between them the call has no callee and no receiver. Checked by parsing `$z = foo ($y);` with the built grammar: function_call_expression with function: name \"foo\", arguments starting one column after it. The same rule applies to Python (`f (x)`) and Java, so it is pre-existing in the runtime; the PHP pack makes it common, because legacy PHP code uses that spacing far more than Python or Java code does. `new Foo ($x)` was fixed in this review by naming a creation from its @call.class capture.\n\nReachable: every PHP file with a call written that way, once a consumer reads calls (PR 6 outbound/database rules, call graphs).\n\nOptions:\n1. (Recommended) In callSites, when no name ends at the list start, take the @call.name inside the invocation that ends latest before the list start and is not inside another argument list. Cost: small change plus unit tests. Risk: changes Python/Java call facts only for calls written with a space, which are wrong today; their goldens must be re-run with grammars built.\n2. Fix it in the PHP pack alone with a PHP-only call reader. Cost: duplicates grouping logic. Not recommended."
acceptanceCriteria:
  - "groupCalls gives `foo ($x)` the callee foo and `$db->query ($sql)` the callee query and receiver $db (unit test in lang-runtime pack-calls.test.ts)"
  - "The PHP pack's facts for a file with `mysql_query ($sql)` name the callee (lang-php test)"
  - "Python, Java and Go pack goldens are unchanged or their diffs are reviewed with grammars built"
touches:
  - "5e5d32b1-26ae-4594-a229-4b579038d053"
priority: "medium"
discoveredFrom: {"item":"5cd796e9-6177-4d40-8439-b1678e700322","run":"27d70059-da72-4a36-a19c-19449c1a9513"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-runtime"
source: "ndx-adversarial-review"
---
