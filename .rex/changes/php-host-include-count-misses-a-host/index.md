---
id: "c480f2d4-f00d-4903-a0dd-8e047c035829"
type: "change"
title: "PHP host-include count misses a host variable read through global, a closure's use() or an arrow function"
slug: "php-host-include-count-misses-a-host"
summary: "Legacy PHP sites often read the tenant's host name into a variable at the top of a file and use it inside a function through `global`. The include report counts those includes as generic dynamic includes, which undercounts the main tenant-selection pattern."
intent: "Adversarial review of task 62d00b31 (run 544cfbc8), should-fix, medium.\n\nFailure scenario: `$host = $_SERVER['HTTP_HOST']; function cfg() { global $host; include \"config/$host.php\"; }` — and likewise `function () use ($host) { include \"config/$host.php\"; }` and `fn() => include \"config/$host.php\"`. `hostReader` (packages/lang-php/src/php-include-notices.ts) matches assignments only in the include's own scope (`scopeAt`, packages/lang-php/src/php-assignments.ts: the innermost @guard.function body). A `global` declaration, a closure's `use` list and an arrow function's implicit by-value capture of the parent scope all bring the outer variable in, so such includes land under [php-dynamic-include] and php-resolve-report.mjs's host-based count misses them. This is an undercount only, the same direction as before the task; nothing is over-counted.\n\nReachable through `ndx analyze` with the PHP pack, and through php-resolve-report.mjs on the legacy corpus. Not covered by any test.\n\nOptions:\n1. (recommended) Capture `global` declarations (`global_declaration` variable names) and closure `use` clause variables in imports.scm (names only, no bodies), and treat an arrow function body as transparent. In hostReader, a variable declared `global` in a scope resolves to the file scope at the function's... note PHP binds global at call time, so take the file scope's last host-reading assignment anywhere before the end of the file, or simply any file-scope assignment that reads the host. A `use ($x)` variable resolves to the parent scope at the closure's position. Cost: one query rule each, about 20 lines, fixture cases. Risk: `global` binds at call time, so position-based \"last assignment\" is an approximation; document it.\n2. Treat any variable named like a host-reading file-scope variable as host-based everywhere: cheap, but it over-counts, which the original task forbids."
acceptanceCriteria:
  - "An include in a function that declares `global $host`, where the file assigned `$host = $_SERVER['HTTP_HOST']`, is counted under [php-host-include], proven by a lang-php integration test"
  - "An include in a closure that takes `use ($host)` from a scope where $host reads the host is counted under [php-host-include]"
  - "An include in an arrow function reading a parent-scope variable that reads the host is counted under [php-host-include]"
  - "An include in a function that neither declares the variable global nor assigns it stays under [php-dynamic-include]"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"62d00b31-5486-4414-ab7d-8beb84c5cb2f","run":"544cfbc8-b4da-4d70-a1b6-609ef222a043"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-php"
source: "ndx-adversarial-review"
---
