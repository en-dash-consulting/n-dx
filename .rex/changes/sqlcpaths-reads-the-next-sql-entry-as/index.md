---
id: "e218ad95-64e5-4fea-a2e1-478a94f3d739"
type: "change"
title: "sqlcPaths reads the next sql[] entry as a path when the key sits on the dash line"
slug: "sqlcpaths-reads-the-next-sql-entry-as"
intent: "Verdict: out-of-scope (pre-existing, low). In packages/sourcevision/src/language/sql-migrations.ts, sqlcPaths ends a block list only when an item's indent is less than the key line's indent. When the key line is itself a sequence entry (\"  - queries:\"), the next sibling entry (\"  - schema: s.sql\") has the same indent, so it is read as a list item.\n\nScenario: sqlcPaths(\"sqlc.yaml\", \"sql:\\n  - queries:\\n      - one.sql\\n  - schema: s.sql\\n\", \"queries\") returns [\"one.sql\", \"schema: s.sql\"] (verified against the built dist). The bogus path is likely filtered out by the existence check in detectMigrationTools, but sqlcPaths' own result is wrong.\n\nReachability: detectMigrationTools has no production consumer yet.\n\nFix (recommended): when the key line's match includes a leading \"-\", the items must be indented further than the key's column (indent of the dash + 2), or the loop must break on item indent <= dash indent. Low cost and low risk; add a unit test."
acceptanceCriteria:
  - "sqlcPaths(\"sqlc.yaml\", \"sql:\\n  - queries:\\n      - one.sql\\n  - schema: s.sql\\n\", \"queries\") returns [\"one.sql\"]"
  - "A unit test in sql-migrations.test.ts covers a key on the dash line followed by a sibling entry"
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
