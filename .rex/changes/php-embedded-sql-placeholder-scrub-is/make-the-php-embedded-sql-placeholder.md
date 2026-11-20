---
id: "1c0e7e35-f15a-481d-924d-179273d23e5c"
type: "task"
title: "Make the PHP embedded-SQL placeholder scrub linear"
slug: "make-the-php-embedded-sql-placeholder"
summary: "Reading table names from PHP SQL could stall for minutes on a query holding a long hex or base64 value; the scan becomes linear so large seed scripts stay fast."
description: "Review finding from task 5f583e76 (run 5ab8edd7), severity medium, should-fix, captured as change 3c06a66b. It ships in PR 6 of the PHP stack (change 38abed61).\n\nDefect: packages/lang-php/src/php-sql.ts, SqlText.tables(): `this.text.replace(TOUCHED, \" ? \")` with `TOUCHED = /[\\w$.`{}]*\\u0000[\\w$.`{}]*/g`. The leading unanchored `[...]*` retries from every start position across a run of word characters, so the scrub is O(L^2) in the longest run. Measured: a SQL literal ending in 0x + 10k/20k/40k word characters took 61/239/953 ms; a 400 KB hex blob in an INSERT passed to mysql_query takes ~100 s. lang-kit's AGENTS.md requires scans of repository content to stay linear.\n\nFix (recommended option): replace the regex with a linear scan that splits on the placeholder and trims the touching name characters from each side with index loops. No behaviour change.\n\nOperator note: touch only packages/lang-php (php-sql.ts and its tests) plus a patch changeset for @n-dx/lang-php. Before finishing, run the six static root policy tests: tests/e2e/architecture-policy.test.js, domain-isolation.test.js, shell-spawn-inventory-policy.test.js, wall-clock-inventory-policy.test.js, layout-literal-policy.test.js, obfuscated-code-policy.test.js."
acceptanceCriteria:
  - "SqlText's placeholder scrub runs in time linear in the SQL text: a unit test feeding a SQL literal with a 1 MB run of word characters, with and without a placeholder, completes within the call-within-budget helper's budget"
  - "The php-data-access integration test still yields the same 18 tables, and an interpolated table ({$table}, archive_$year) still yields none"
priority: "medium"
run: {"tier":"standard","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
source: "ndx-adversarial-review"
---
