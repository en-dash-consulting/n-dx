---
id: "c5dc701b-6c05-4e41-a5a4-247ed7ffce30"
type: "change"
title: "sqlc block lists stop at a comment-only or blank line, dropping the items after it"
slug: "sqlc-block-lists-stop-at-a-comment"
intent: "Verdict: out-of-scope (pre-existing, low). In packages/sourcevision/src/language/sql-migrations.ts, sqlcPaths scans a block list with `/^(\\s*)-\\s*(.+)$/` and breaks on the first line that is not a list item. A comment-only line (`  # main`) or a blank line inside the list ends the scan.\n\nScenario: `queries:\\n  # main\\n  - q.sql\\n` returns [] for queries, so q.sql is missing from queryFiles. If schema: has the same shape, the whole sqlc finding is dropped.\n\nReachability: detectMigrationTools has no production consumer yet. This becomes reachable once sqlFiles/queryFiles feed extractSqlTables/extractSqlcTables.\n\nFix (recommended): in the block-list loop, skip lines that are blank or whose trimmed text starts with `#` (continue) rather than breaking. Cheap and low risk."
acceptanceCriteria:
  - "sqlcPaths(\"sqlc.yaml\", \"queries:\\n  # main\\n  - q.sql\\n\", \"queries\") returns [\"q.sql\"]"
  - "A blank line between block-list items does not end the list"
  - "A unit test in sql-migrations.test.ts covers both forms"
touches:
  - "d8fccdeb-f9b5-4da2-be41-c5594fa0451f"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "sql"
  - "sourcevision"
source: "ndx-adversarial-review"
---
