---
id: "c9c18715-b303-411c-b8b0-d44d0e91be57"
level: "task"
title: "sqlc detection omits the schema files named by sqlc.yaml's schema: key"
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
  - "A sqlc fixture with schema: \"schema.sql\" reports schema.sql in the sqlc finding's sqlFiles"
  - "Schema given as a directory or a list resolves relative to the config like queries does"
  - "MigrationToolFinding.sqlFiles documentation matches what sqlc reports"
description: "Verdict: should-fix (low). packages/sourcevision/src/language/sql-migrations.ts detectMigrationTools reads only `queries:` from a sqlc config, so a sqlc finding's sqlFiles lists query files (SELECTs) and never the `schema:` files that hold the CREATE TABLE statements. Scenario: sqlc.yaml with `queries: \"query/\"` and `schema: \"schema.sql\"` -> sqlFiles = [\"query/users.sql\"]; schema.sql (the tables) is not reported, so table extraction over a tool's sqlFiles finds no tables for sqlc repositories. The MigrationToolFinding.sqlFiles doc also claims \"files holding schema statements\", which is wrong for sqlc. Reachable once a consumer feeds sqlFiles into extractSqlTables (sibling tasks); no consumer today. Fix: generalise sqlcQueryPaths to take the key name and read `schema:` too (cheap, low risk); record schema files as sqlFiles, and queries separately or as files only. Recommended."
lastModified: "2026-10-08T08:15:03.778Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
