---
id: "1b7a44bc-a83a-47ad-9205-893373dd4fba"
type: "change"
title: "sqlc config values with a trailing YAML comment resolve to a bogus path"
slug: "sqlc-config-values-with-a-trailing"
intent: "Verdict: out-of-scope (pre-existing, low). This dates from `sqlcQueryPaths`, and `sqlcPaths` now applies the same parsing to `schema:` too. In `packages/sourcevision/src/language/sql-migrations.ts`, the `unquote` step inside `sqlcPaths` only trims whitespace, removes a trailing comma and removes the quotes at either end. It never removes a YAML `#` comment.\n\nScenario: a sqlc.yaml containing `schema: \"schema.sql\"  # tables` produces the path `schema.sql\"  # tables`. That matches no file. The schema file is then missing from sqlFiles, and if `queries:` has the same problem the whole sqlc finding is dropped. The same happens for unquoted values (`queries: query/ # sql`) and for block-list items.\n\nReachability: `detectMigrationTools` has no production consumer today, so nothing hits this yet. It becomes reachable once a sibling task feeds sqlFiles into `extractSqlTables`.\n\nFix: before unquoting, strip a ` #...` suffix that sits outside quotes. This is cheap and low risk, because sqlc paths do not contain `#`. Recommended."
acceptanceCriteria:
  - "sqlcPaths(\"sqlc.yaml\", 'schema: \"schema.sql\"  # tables', \"schema\") returns [\"schema.sql\"]"
  - "An unquoted scalar and a block-list item with a trailing # comment resolve to the bare path"
  - "A unit test in sql-migrations.test.ts covers the commented forms"
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
