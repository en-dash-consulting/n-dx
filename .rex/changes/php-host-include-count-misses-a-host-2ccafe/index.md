---
id: "2ccafe80-90b9-4721-8893-e0aa272687e0"
type: "change"
title: "PHP host-include count misses a host variable whose last branch assigns a fallback"
slug: "php-host-include-count-misses-a-host-2ccafe"
summary: "Old PHP sites often pick the tenant's host name in an if/else, with a fixed fallback in the else branch. The include report then treats the include as not host-based, undercounting the tenant-selection pattern it is meant to size."
intent: "Adversarial review of task 62d00b31 (run 544cfbc8), should-fix, medium.\n\nFailure scenario: `if (isset($_SERVER['HTTP_HOST'])) { $host = $_SERVER['HTTP_HOST']; } else { $host = 'localhost'; } include \"config/$host.php\";`. `hostReader` (packages/lang-php/src/php-include-notices.ts, the `variable` closure) takes the last assignment in document order, and the else branch's literal comes last, so the include is counted under [php-dynamic-include] although at run time it is host-based on every web request. (PhpIncludes.resolve never evaluates variables for a plain include, so the include is dynamic either way: verified at php-includes.ts:731.) The reverse order (host in the else branch) is counted correctly, so the result depends on branch order. The ternary form `$host = isset(...) ? $_SERVER['HTTP_HOST'] : 'localhost'` is one assignment and is counted correctly.\n\nReachable through `ndx analyze` with the PHP pack and php-resolve-report.mjs. Not covered by a test.\n\nOptions:\n1. (recommended) When the last assignment sits inside a conditional region (an `if`/`else`/`switch` body, a @guard.conditional capture that is not @guard.function), also consider the earlier assignments back to the last one that is not conditional relative to the include, and count the include host-based when any of them reads the host. Cost: about 15 lines plus fixture cases. Risk: a host read in a dead branch counts; acceptable for a sizing report.\n2. Count host-based when any assignment to the variable in the scope reads the host. Simpler, but it contradicts the task's \"reassigned from anything else stays dynamic\" case (`$host = $_SERVER[...]; ...; $host = getenv('SITE');`)."
acceptanceCriteria:
  - "An include whose variable is assigned the host in an if branch and a literal in its else branch, in either order, is counted under [php-host-include], proven by a lang-php integration test"
  - "An include whose variable is assigned the host and then unconditionally reassigned from another value stays under [php-dynamic-include]"
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
