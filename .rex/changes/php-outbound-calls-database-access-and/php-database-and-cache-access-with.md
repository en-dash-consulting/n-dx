---
id: "5f583e76-168b-40b6-b8a0-d42faa7e1fa3"
type: "task"
title: "PHP database and cache access with embedded SQL table names"
slug: "php-database-and-cache-access-with"
summary: "Report the databases and caches PHP code connects to and the tables its SQL reads and writes, so overlapping tenant databases show up before consolidation."
description: "In `@n-dx/lang-php`:\n\n- database outbound calls: `mysql_connect`/`mysql_pconnect`, `mysqli_connect`/`new mysqli`, `new PDO($dsn, …)` (driver and host from a literal DSN), `pg_connect`, `oci_connect`, `sqlsrv_connect`, `odbc_connect`, and Doctrine DBAL `DriverManager::getConnection([...])` with literal params. Target from literals, env or config keys as in the HTTP task.\n- cache: `new Memcache`/`new Memcached` with `addServer`/`connect`, `new Redis` with `connect`, Predis `new Predis\\Client(...)`.\n- Embedded SQL: string literals (including heredoc/nowdoc and simple concatenations of literals) passed to `mysql_query`, `mysqli_query`, `->query`, `->prepare`, `->exec`, `pg_query`, `pg_prepare` and similar: run lang-kit's `looksLikeSql` and `extractSqlTableReferences` (packages/lang-kit/src/sql-references.ts) and feed the table names into the existing in-memory database signals the way Java and Go embedded SQL is fed (find that path in sourcevision and reuse it).\n\nFixtures: a PHP 5 `mysql_*` app, a PDO app with prepared statements, a heredoc SQL query, and Memcache/Redis clients."
acceptanceCriteria:
  - "mysql_*, mysqli, PDO, pg, oci, sqlsrv, odbc and Doctrine DBAL connections appear as database outbound calls"
  - "Memcache, Memcached, Redis and Predis clients appear as cache outbound calls"
  - "Embedded SQL in query and prepare calls yields table names through lang-kit's SQL extractor"
priority: "medium"
run: {"tier":"heavy","review":true,"reviewTier":"heavy","skipTestGate":true,"maxTurns":120}
tags:
  - "php"
  - "lang-php"
  - "outbound"
  - "sql"
blockedBy:
  - "2e742c9b-d521-43ee-992a-6adb3423eed7"
---
