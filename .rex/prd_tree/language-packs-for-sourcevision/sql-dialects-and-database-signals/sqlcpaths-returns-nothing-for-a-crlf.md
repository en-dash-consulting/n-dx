---
id: "8d2ff68d-5695-4b3d-8105-d217032011b2"
level: "task"
title: "sqlcPaths returns nothing for a CRLF sqlc.yaml block list"
status: "pending"
priority: "low"
tags:
  - "ndx-adversarial-review"
  - "severity:low"
  - "language-packs"
  - "sql"
  - "sourcevision"
source: "ndx-adversarial-review"
acceptanceCriteria:
  - "sqlcPaths(\"sqlc.yaml\", \"queries:\\r\\n  - q.sql\\r\\n\", \"queries\") returns [\"q.sql\"]"
  - "A unit test in sql-migrations.test.ts covers a CRLF block list"
description: "Verdict: out-of-scope (pre-existing, low). packages/sourcevision/src/language/sql-migrations.ts sqlcPaths splits on \"\\n\" only. With CRLF line endings the key line \"queries:\\r\" captures value \"\\r\", which is non-empty, so it takes the scalar branch: unquote trims it to \"\", nothing is pushed, and the block-list loop never runs.\n\nScenario: sqlcPaths(\"sqlc.yaml\", \"queries:\\r\\n  - q.sql\\r\\n\", \"queries\") returns [] (verified against the built dist). A Windows-authored sqlc.yaml loses all its block-list queries and schema paths.\n\nReachability: detectMigrationTools has no production consumer yet. This becomes reachable once queryFiles and sqlFiles feed table extraction.\n\nFix (recommended): split on /\\r?\\n/, or trim the captured value before the `value !== \"\"` check. Cost is one line, low risk."
lastModified: "2026-10-11T04:34:30.852Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
