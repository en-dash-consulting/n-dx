---
id: "aa82237e-ac2e-4749-94a8-f09d68fd6a5c"
type: "change"
title: "Spring Data JDBC and R2DBC @Query and @Table(\"name\") are read with JPA semantics, so their tables are missed"
slug: "spring-data-jdbc-and-r2dbc-query-and"
intent: "Severity medium, verdict should-fix (found by adversarial review of bb36a688).\n\nScenario: a Spring Data JDBC repository `@Query(\"SELECT * FROM owners\")` (org.springframework.data.jdbc.repository.query.Query, always native SQL, no nativeQuery attribute) is treated as JPQL by extractJavaEmbeddedSql (packages/sourcevision/src/language/java-sql.ts, the `annotation.name === \"Query\"` branch). \"owners\" has no @Entity, so it lands in `unresolved` instead of `tables`. Likewise Spring Data JDBC/R2DBC's `@Table(\"owners\")` (org.springframework.data.relational.core.mapping.Table, unnamed value) yields nothing, because only the `name` key is read.\n\nReachable: any Spring Data JDBC or R2DBC repository; nothing wires the extractor into analysis yet, so today only callers of extractJavaEmbeddedSql see it.\n\nOptions: (a) recommended: read the file's `imports` captures; when `Query` resolves to a spring-data jdbc/r2dbc package treat it as native, and read `@Table`'s unnamed value or `value` key when `Table` resolves to org.springframework.data.relational. Cost: small; risk: wildcard imports leave it ambiguous (fall back to current behaviour). (b) treat any @Query whose JPQL names resolve to no entity as native. Cheaper but turns genuine JPQL typos into fake tables."
acceptanceCriteria:
  - "A test with `import org.springframework.data.jdbc.repository.query.Query;` and `@Query(\"SELECT * FROM owners\")` yields table owners with via `@Query (native)` and nothing in unresolved"
  - "A test with `import org.springframework.data.relational.core.mapping.Table;` and `@Table(\"owners\")` yields table owners"
  - "JPA @Query and @Table(name=...) results in tests/integration/embedded-sql.test.ts are unchanged"
touches:
  - "d8fccdeb-f9b5-4da2-be41-c5594fa0451f"
priority: "medium"
tags:
  - "ndx-adversarial-review"
  - "severity:medium"
  - "language-packs"
  - "sql"
  - "sourcevision"
source: "ndx-adversarial-review"
---
