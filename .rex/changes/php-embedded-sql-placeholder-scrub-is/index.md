---
id: "3c06a66b-9c74-4f19-9fd1-878c6a9d951c"
type: "change"
title: "PHP embedded-SQL placeholder scrub is quadratic on a long run of word characters"
slug: "php-embedded-sql-placeholder-scrub-is"
summary: "Reading table names from a PHP file's SQL can take minutes when a query holds a long unbroken value such as a hex blob, so a corpus or analysis run over such a repository stalls."
intent: "Verdict: should-fix (severity medium). Found by the adversarial review of task 5f583e76 (run 5ab8edd7).\n\nDefect: packages/lang-php/src/php-sql.ts, SqlText.tables(): `this.text.replace(TOUCHED, \" ? \")` with `TOUCHED = /[\\w$.`{}]*\\u0000[\\w$.`{}]*/g`. The leading unanchored `[...]*` retries from every start position across a run of word characters, so the scrub is O(L^2) in the longest run. Measured with node: a SQL literal ending in 0x + 10k/20k/40k word characters took 61/239/953 ms; a 400 KB hex blob in an INSERT passed to mysql_query takes ~100 s. lang-kit's AGENTS.md requires scans of repository content to stay linear.\n\nReachability: extractPhpEmbeddedSql is exported for corpus scripts and tests, and no analyze path calls it yet, so analyze does not hang today. The first caller that wires PHP embedded SQL into a run (a corpus report, a database-signal phase) inherits the hang on a repository with a seed or fixture script holding a large hex or base64 literal.\n\nOptions: (a) recommended: replace the regex with a linear scan that splits on the placeholder and trims the touching name characters from each side with index loops (cheap, local, no behaviour change). (b) skip the replace when the text holds no placeholder (cheap, but the quadratic case remains when one is present). (c) cap SQL text length before scrubbing (loses tables in long statements)."
acceptanceCriteria:
  - "SqlText's placeholder scrub runs in time linear in the SQL text: a unit test feeding a SQL literal with a 1 MB run of word characters, with and without a placeholder, completes within the call-within-budget helper's budget"
  - "The php-data-access integration test still yields the same 18 tables, and an interpolated table (`{$table}`, `archive_$year`) still yields none"
touches:
  - "3c3ffe2f-8bc9-4b80-aa1d-ddab68f0fe11"
priority: "medium"
discoveredFrom: {"item":"5f583e76-168b-40b6-b8a0-d42faa7e1fa3","run":"5ab8edd7-bd0e-4dbc-9154-e42849aaa59b"}
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "php"
  - "lang-php"
  - "sql"
source: "ndx-adversarial-review"
---
