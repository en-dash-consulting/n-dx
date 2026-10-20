---
id: "288b6fdf-a51b-4007-a6e5-30c473fcbb98"
level: "task"
title: "sqlcPaths reads nothing from a sqlc.yaml sql[] entry written as a flow mapping"
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
  - "sqlcPaths(\"sqlc.yaml\", \"sql:\\n  - {engine: pg, schema: s.sql, queries: q}\\n\", \"schema\") returns [\"s.sql\"], and the same call with \"queries\" returns [\"q\"]"
  - "A flow mapping whose schema value is a flow list ({schema: [a.sql, b.sql]}) yields both paths"
  - "A unit test in packages/sourcevision/tests/unit/language/sql-migrations.test.ts covers both forms"
description: "Verdict: out-of-scope. Pre-existing and low severity. It was found during the adversarial review of 71c1e226 (sqlc JSON arrays).\n\nLocation: packages/sourcevision/src/language/sql-migrations.ts, the keyPattern in sqlcPaths. The pattern only matches a key at the start of a line, after an optional `-`. A YAML flow mapping such as `- {engine: postgresql, schema: s.sql, queries: q}` puts the key after `{`, so the pattern never matches it.\n\nScenario: sqlcPaths(\"sqlc.yaml\", \"sql:\\n  - {engine: pg, schema: s.sql, queries: q}\\n\", \"schema\") returns []. This was verified against the source. detectMigrationTools then drops the config, and sqlc goes undetected.\n\nReachability: latent. detectMigrationTools is not called from analyze yet. The form is legal YAML but uncommon in sqlc configs.\n\nOptions:\n(a) Parse YAML configs with a real YAML parser. This is the most robust option, but sourcevision would need a dependency, or lang-kit's YAML parser would have to support flow mappings.\n(b) Before the key match, rewrite a `{...}` on one line into its `key: value` pairs. This is cheap and covers the single-line form only.\nRecommendation: (b), unless lang-kit's YAML parser already handles flow mappings. In that case use it."
lastModified: "2026-10-17T07:36:32.707Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
