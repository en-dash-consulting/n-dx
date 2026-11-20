---
id: "03468932-0d88-42ed-a764-c25c654a20f5"
type: "task"
title: "Keep field-specific database provenance through parentheses"
slug: "keep-field-specific-database"
summary: "Stops redundant brackets in code from making the scan claim that a value came from the database when it did not."
description: "#1082 inline thread 4593510905 (P2 in that review), `packages/lang-php/src/php-database-flow.ts` (`readPathOf`, the `readWhole` fallback, and assignment copying via `variable(right)`).\n\nReproduction (invented):\n```php\n$row = mysql_fetch_assoc(mysql_query('SELECT body FROM blocks'));\n$x = new stdClass; $x->body = $row['body']; $x->handler = 'trim';\ncall_user_func(($x)->handler);\n```\nThe site is marked as reading `blocks.body`. `readPathOf` cannot identify a parenthesised base, so the fallback evaluates the whole object via `readWhole`, merging the database-fed `body` into the literal `handler`. The equivalent `$y = ($x); call_user_func($y->handler);` also fails, because assignment copies per-path state only when `variable(right)` recognises a direct variable.\n\nFix: unwrap parenthesised expressions when identifying a variable or path and when copying field-specific state.\n\nTests: both variants above are not database-driven; the unparenthesised database-driven case still is."
acceptanceCriteria:
  - "Both parenthesised variants are not reported as database-driven"
  - "Existing database-driven cases are unchanged"
priority: "medium"
run: {"tier":"light","review":true,"skipTestGate":true}
tags:
  - "lang-php"
  - "database-flow"
---
