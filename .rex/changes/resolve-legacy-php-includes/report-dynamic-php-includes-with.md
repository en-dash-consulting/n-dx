---
id: "fd220c20-0191-4388-b858-0a1454884daa"
type: "task"
title: "Report dynamic PHP includes with literal-prefix candidates, and the include resolution report"
slug: "report-dynamic-php-includes-with"
summary: "Count the includes whose target is only known at run time, list the files they could load when part of the path is fixed, and measure how much of each legacy corpus app's wiring the pack resolves."
description: "- Every include whose path cannot be computed becomes a notice with file and line, counted per repository (the Python pack's dynamic-import notices are the precedent: packages/lang-python/src/python-notices.ts).\n- When the path starts with a computable literal prefix and/or ends with a literal suffix (`\"config/\" . $_SERVER['HTTP_HOST'] . \".php\"`, `ROOT . '/modules/' . $name . '/index.php'`), fill the written import's `candidates` (decision D3) with the repository files that match prefix and suffix, sorted, capped (state the cap and report truncation). Candidates are never edges; add a test that zones and imports.json are unchanged by them.\n- Host-based tenant config (`$_SERVER['HTTP_HOST']`, `$_SERVER['SERVER_NAME']` in the path) gets its own notice code, since it is the main tenant-selection pattern in multi-tenant legacy estates.\n- Extend `php-resolve-report.mjs` (from the Composer PR) with include resolution: per corpus repository, includes resolved / computable-unresolved / dynamic-with-candidates / dynamic-without, and a random sample of 20 resolved and 20 unresolved includes for hand-checking.\n\n**Operator note:** the operator runs the report on the corpus after the run and logs the numbers and the hand-checked sample with append_log."
acceptanceCriteria:
  - "Dynamic includes are reported as notices with locations, and host-based ones have their own notice code"
  - "Literal-prefix dynamic includes carry capped candidate lists that never become edges, proven by a test"
  - "The resolve report covers includes per corpus repository and its numbers are logged"
priority: "high"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "php"
  - "lang-php"
  - "resolver"
blockedBy:
  - "973d69dd-ecc6-4a80-8b4a-38f3fff87e09"
---
