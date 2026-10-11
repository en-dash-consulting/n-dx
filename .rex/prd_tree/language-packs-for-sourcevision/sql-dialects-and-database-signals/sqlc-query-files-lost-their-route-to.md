---
id: "6bfc0a33-2ac2-4b2e-ac78-cc546780a8be"
level: "task"
title: "sqlc query files lost their route to extractSqlcTables when sqlFiles became schema-only"
status: "pending"
priority: "medium"
source: "ndx-work-gate"
acceptanceCriteria:
  - "tests/integration/embedded-sql.test.ts 'sqlc query files' passes, reading extractSqlcTables over sqlc.queryFiles and getting the same three rows as before (authors GetAuthor, books ListBooks, authors ListBooks)"
  - "The same test asserts sqlc.sqlFiles equals [\"db/schema.sql\"]"
  - "MigrationToolFinding documents queryFiles, and sql-migrations.test.ts asserts it for the scalar, directory and list forms of queries:"
  - "The full sourcevision suite passes (cd packages/sourcevision && SV_REQUIRE_GRAMMARS=1 npx vitest run), not only the unit tests"
description: "cb3ce022c (run a3f6511e, task c9c18715) made a sqlc finding's sqlFiles the schema: files and left the queries: files in files only. tests/integration/embedded-sql.test.ts 'sqlc query files' (added in bb36a688) feeds sqlc.sqlFiles into extractSqlcTables and now fails: expected [db/query/authors.sql, db/query/books.sql], received [db/schema.sql]. The query files have no field of their own, so a consumer cannot tell them from the config file in files. The run only ran the unit tests, so it missed this. Fix: add an optional queryFiles to MigrationToolFinding (sqlc only: the existing .sql files under queries:, sorted, a subset of files), keep sqlFiles as the schema files, and point the integration test's extractSqlcTables call at queryFiles. Do not just change the assertion to db/schema.sql: that drops the only route from sqlc query files to table references."
lastModified: "2026-10-11T04:06:53.976Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---
