---
id: "eb319918-d699-4f6f-99ce-1fc453155d70"
type: "task"
title: "Report static calls whose class is dynamic, and track database provenance per property"
slug: "report-static-calls-whose-class-is"
summary: "Catch the database-routing pattern where a class name loaded from a table is called with a fixed method name, and stop marking unrelated object fields as database-driven."
description: "Closes two Codex threads on #1081.\n\n**1. Thread 4592673573** (`packages/lang-php/src/php-dynamic-code.ts`, `byValue` in `codeSites`).\n- **Problem.** `byValue` skips every call whose method is a literal name before it looks at the class. So this produces no fact:\n  ```php\n  $row = mysql_fetch_assoc(mysql_query('SELECT controller FROM routes'));\n  $class = $row['controller'];\n  $class::run();\n  ```\n  That is the client's database-routing pattern.\n- **Fix.**\n  - For scoped (static) calls, record a dispatch site when either the class or the method is dynamic.\n  - Pass the dynamic operand, class and/or method, into database-flow analysis, so the routes example is database-driven from `routes.controller`.\n  - Instance method calls with a literal name stay unreported, as today.\n\n**2. Thread 4592673591** (`packages/lang-php/src/php-database-flow.ts`, around line 351).\n- **Problem.** One database-fed property write taints the whole root object, and later literal writes never clear it. So this is reported as database-driven from `blocks.body`:\n  ```php\n  $x->body = $row['body'];\n  $x->handler = 'trim';\n  call_user_func($x->handler);\n  ```\n- **Fix.**\n  - Track provenance per access path (`$x->body`, `$x->handler`, `$a['k']`, one level deep is enough).\n  - A literal assignment to a path clears it.\n  - Reading a path nobody assigned falls back to the root's provenance only when the root itself was assigned a database value (`$x = $row`).\n  - When a relationship is uncertain, leave it unmarked. The change's rule is to prefer missing a flow over guessing one.\n\n**Tests:**\n- both reproductions;\n- `$class::$method()` still reported;\n- `$obj = $row; call_user_func($obj['handler'])` still database-driven;\n- the existing database-flow fixtures unchanged, except where they relied on the root-tainting bug (explain each such golden change in the log)."
acceptanceCriteria:
  - "A static call with a dynamic class and a literal method is reported as a dispatch site, and as database-driven when the class comes from a query"
  - "A literal property assignment is not marked database-driven because another property of the same object was"
  - "Whole-row assignments still carry database provenance to their elements"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":150}
tags:
  - "php"
  - "lang-php"
blockedBy:
  - "938d1611-a5d7-4fd9-81e5-422e2b47a776"
---
