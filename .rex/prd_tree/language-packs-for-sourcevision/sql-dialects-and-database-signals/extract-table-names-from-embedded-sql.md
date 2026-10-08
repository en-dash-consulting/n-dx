---
id: "bb36a688-3b5f-41d3-b493-af19d00447f7"
level: "task"
title: "Extract table names from embedded SQL in Java and Go"
status: "pending"
priority: "medium"
description: "Use the Java and Go packs' call and annotation captures to find embedded SQL: Spring Data @Query (native and JPQL), JdbcTemplate query/update methods, JPA @Table; Go database/sql Query/QueryRow/Exec, sqlx Get/Select, and sqlc query files. Extract table names (JPQL entity names map through @Entity/@Table). These feed later code-to-database links, which are not persisted yet."
lastModified: "2026-10-08T03:09:30.351Z"
lastModifiedBy: "Ryan Keith <ryan.k@endash.us>"
tags:
  - "language-packs"
  - "sql"
  - "sourcevision"
  - "pr-9"
source: "roadmap"
blockedBy:
  - "8d693fcd-f39f-4008-8149-24596e014479"
acceptanceCriteria:
  - "Java fixtures with @Query, JdbcTemplate and @Table yield table names"
  - "Go fixtures with database/sql, sqlx and sqlc yield table names"
  - "Results stay in memory"
  - "The six static root policy tests pass"
---
