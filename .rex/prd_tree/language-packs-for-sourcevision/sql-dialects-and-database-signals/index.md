---
id: "d8fccdeb-f9b5-4da2-be41-c5594fa0451f"
level: "feature"
title: "SQL dialects and database signals"
status: "pending"
priority: "medium"
tags:
  - "language-packs"
  - "sql"
  - "database"
  - "sourcevision"
  - "side-stack"
  - "pr-9"
blockedBy:
  - "8b4b34af-ec1d-4593-8266-67e39928289c"
source: "roadmap"
acceptanceCriteria:
  - "Migration and schema files are found by tool and parsed for dialect and table names"
  - "Database engine candidates come from dependencies, container images, config and IaC, each with its evidence"
  - "Embedded SQL in Java and Go yields table names"
  - "No connection host, user or password is stored or logged"
  - "Nothing is written to infrastructure.json"
  - "The six static root policy tests pass"
description: "LS13 and LS14: find the databases a repository uses and the SQL dialect it writes, from five signals (IaC, container images, dependencies, config, schema and migrations), held in memory. Dialect and table names only: no full SQL parsing. NoSQL engines are detected from drivers and config. Persisting database resources and code-to-database links into infrastructure.json waits for the conversation with Sterling H. Config is read for key names and URL schemes only: hosts, users and passwords are never stored or logged.\n\nSide stack, PR 9. Uses the Java and Go packs' call captures for embedded SQL."
lastModified: "2026-10-08T03:09:17.985Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
---

## Children

| Title | Status |
|-------|--------|
| [Add the Terraform model as a database-engine source](./add-the-terraform-model-as-a-database.md) | pending |
| [Classify SQL dialects with evidence](./classify-sql-dialects-with-evidence.md) | completed |
| [Detect database engines from dependencies, images and config](./detect-database-engines-from.md) | completed |
| [Extract table names from embedded SQL in Java and Go](./extract-table-names-from-embedded-sql.md) | completed |
| [Find migration and schema files and extract tables with tree-sitter-sql](./find-migration-and-schema-files-and.md) | completed |
| [Go calls query leaves string arguments of unnamed calls without an owning argument list](./go-calls-query-leaves-string-arguments.md) | completed |
| [Spring Data JDBC and R2DBC @Query and @Table("name") are read with JPA semantics, so their tables are missed](./spring-data-jdbc-and-r2dbc-query-and.md) | completed |
| [SQL dialect goldens are inline PetClinic-shaped snippets, never checked against PetClinic's real schema files](./sql-dialect-goldens-are-inline.md) | pending |
| [sqlc detection omits the schema files named by sqlc.yaml's schema: key](./sqlc-detection-omits-the-schema-files.md) | pending |
