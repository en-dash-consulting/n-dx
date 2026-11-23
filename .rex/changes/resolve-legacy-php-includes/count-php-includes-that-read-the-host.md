---
id: "62d00b31-5486-4414-ab7d-8beb84c5cb2f"
type: "task"
title: "Count PHP includes that read the host through a variable as host-based"
slug: "count-php-includes-that-read-the-host"
summary: "Legacy multi-tenant PHP sites often copy the request's host name into a variable before loading a tenant's configuration file. Count those includes as host-based too, so the report sizes the main tenant-selection pattern correctly."
description: "Review finding from run cbe8c6b8 (task fd220c20), should-fix, medium.\n\nFailure scenario: `$host = $_SERVER['HTTP_HOST']; include \"config/$host.php\";` (or `$tenant = strtolower($_SERVER['SERVER_NAME'])`). `isHostInclude` (packages/lang-php/src/php-include-notices.ts) tests only the include's own path expression for `$_SERVER['HTTP_HOST'|'SERVER_NAME']`, so the include lands in `[php-host-include]` only when the superglobal is written inline. Through a variable it is counted under `[php-dynamic-include]`, and php-resolve-report.mjs's host-based count misses it.\n\nFix: use the `include.assign` / `include.assign_value` captures already in imports.scm. When a variable in the include's path was last assigned, in the same function scope (or file scope), a value that reads `$_SERVER['HTTP_HOST']` or `$_SERVER['SERVER_NAME']` (directly or through a function call such as strtolower), mark the include host-based. Task f3198e15 (run before this one) restricts which assignment right-hand sides are captured; make sure its allow-list keeps the forms this needs (subscript_expression, function_call_expression) and extend it if not. Do not mark every include in a file that reads the host anywhere: that over-counts."
acceptanceCriteria:
  - "An include whose path uses a variable assigned from $_SERVER['HTTP_HOST'] or $_SERVER['SERVER_NAME'] in the same scope is counted under [php-host-include], proven by a lang-php integration test"
  - "An include whose variable is assigned from anything else stays under [php-dynamic-include]"
  - "php-resolve-report.mjs counts such includes as host-based"
priority: "medium"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":100}
tags:
  - "php"
  - "lang-php"
  - "resolver"
blockedBy:
  - "f3198e15-a42e-4e05-9917-a6be8ff68d36"
---
